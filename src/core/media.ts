import { ascii, startsWith, u32be } from "./bytes.ts";

// 音訊與影片的格式判斷，以及判斷時要用到的幾個小工具。清除的程式在 src/tools/strip-metadata/。

export type MediaFormat = "mp3" | "m4a" | "mp4" | "mov" | "wav" | "avi" | "flac" | "ogg" | "opus" | "mkv" | "webm";

export const syncsafe = (bytes: Uint8Array, at: number) =>
  ((bytes[at]! & 0x7f) << 21) | ((bytes[at + 1]! & 0x7f) << 14) | ((bytes[at + 2]! & 0x7f) << 7) | (bytes[at + 3]! & 0x7f);

// ID3v2 標籤的總長度（含標頭與結尾），at 不是 ID3v2 時回傳 0
export function id3v2Size(bytes: Uint8Array, at: number): number {
  if (!startsWith(bytes, at, "ID3") || at + 10 > bytes.length) return 0;
  const version = bytes[at + 3]!;
  if (version < 2 || version > 4) return 0;
  if ([6, 7, 8, 9].some((i) => bytes[at + i]! & 0x80)) return 0;
  const footer = version === 4 && bytes[at + 5]! & 0x10 ? 10 : 0;
  const size = 10 + syncsafe(bytes, at + 6) + footer;
  return at + size <= bytes.length ? size : 0;
}

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as Record<number, number[]>;

// MPEG Layer III 音訊框的長度，不是音訊框就回傳 0
export function mp3FrameLength(bytes: Uint8Array, i: number): number {
  if (i + 4 > bytes.length || bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) return 0;
  const version = (bytes[i + 1]! >> 3) & 3;
  const layer = (bytes[i + 1]! >> 1) & 3;
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[bytes[i + 2]! >> 4];
  const rate = SAMPLE_RATES[version]?.[(bytes[i + 2]! >> 2) & 3];
  if (version === 1 || layer !== 1 || !bitrate || !rate) return 0;
  const padding = (bytes[i + 2]! >> 1) & 1;
  return Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / rate) + padding;
}

// 從 at 開始找音訊框，要連續兩個都對上，避免把其他資料誤認成同步碼
export function findMp3Frame(bytes: Uint8Array, at: number, limit = 65536): number {
  const end = Math.min(bytes.length, at + limit);
  for (let i = at; i < end; i++) {
    const length = mp3FrameLength(bytes, i);
    if (!length) continue;
    if (i + length === bytes.length || mp3FrameLength(bytes, i + length)) return i;
  }
  return -1;
}

export type OggCodec = "vorbis" | "opus";

export function oggCodec(bytes: Uint8Array): OggCodec | null {
  if (!startsWith(bytes, 0, "OggS") || bytes.length < 28 + 8) return null;
  const body = 27 + bytes[26]!;
  if (startsWith(bytes, body, "\x01vorbis")) return "vorbis";
  if (startsWith(bytes, body, "OpusHead")) return "opus";
  return null;
}

// EBML 的可變長度整數：第一個位元組前面有幾個 0，就再多讀幾個位元組
function vint(bytes: Uint8Array, at: number, keepMarker: boolean): [value: number, length: number] | null {
  const first = bytes[at];
  if (!first) return null;
  const length = Math.clz32(first) - 23;
  if (at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i]!;
  return [value, length];
}

// EBML 標頭裡的 DocType：matroska 或 webm
function ebmlDocType(bytes: Uint8Array): string | null {
  if (bytes.length < 8 || u32be(bytes, 0) !== 0x1a45dfa3) return null;
  const size = vint(bytes, 4, false);
  if (!size) return null;
  const end = Math.min(bytes.length, 4 + size[1] + size[0]);
  for (let at = 4 + size[1]; at < end; ) {
    const id = vint(bytes, at, true);
    const length = id && vint(bytes, at + id[1], false);
    if (!id || !length) return null;
    const data = at + id[1] + length[1];
    if (id[0] === 0x4282) return ascii(bytes, data, Math.min(length[0], end - data)).replace(/\0+$/, "");
    at = data + length[0];
  }
  return null;
}

// ISO 基本媒體檔案格式：ftyp 的品牌決定副檔名。沒有 ftyp 的舊 QuickTime 檔開頭直接是 moov 或 mdat
function isoKind(bytes: Uint8Array): MediaFormat | null {
  const type = ascii(bytes, 4, 4);
  if (type === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "qt  ") return "mov";
    if (["M4A ", "M4B ", "M4P "].includes(brand)) return "m4a";
    if (brand === "crx ") return null; // Canon 的 RAW 照片
    return "mp4";
  }
  if (["moov", "mdat", "wide", "free", "skip"].includes(type) && u32be(bytes, 0) >= 8) return "mov";
  return null;
}

export function mediaKind(bytes: Uint8Array): MediaFormat | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, 0, "RIFF") || startsWith(bytes, 0, "RF64")) {
    const form = ascii(bytes, 8, 4);
    return form === "WAVE" ? "wav" : form === "AVI " ? "avi" : null;
  }
  if (startsWith(bytes, 0, "fLaC")) return "flac";
  const codec = oggCodec(bytes);
  if (codec) return codec === "opus" ? "opus" : "ogg";
  const docType = ebmlDocType(bytes);
  if (docType) return docType === "webm" ? "webm" : docType === "matroska" ? "mkv" : null;
  const iso = isoKind(bytes);
  if (iso) return iso;
  // ID3 也會接在 FLAC 前面
  const id3 = id3v2Size(bytes, 0);
  if (id3 && startsWith(bytes, id3, "fLaC")) return "flac";
  if (findMp3Frame(bytes, id3, id3 ? 65536 : 4) >= 0) return "mp3";
  return null;
}

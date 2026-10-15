import { type Format, ascii, u16be, u32be } from "../../core/bytes.ts";
import { id3v2Size, mp3FrameLength } from "../../core/media.ts";
import { type Box, readBoxes } from "../strip-metadata/heif.ts";
import { sampleRanges } from "../strip-metadata/mp4.ts";

// 長錄音分段解碼用的檔案結構解析。錄音可能有好幾個小時、好幾 GB，不整個讀進記憶體，
// 每次只解碼約 10 分鐘（src/ui/audio-stream.ts）。這裡只算出每一段在檔案裡的位置，
// 解碼交給瀏覽器，可以在 Node 裡測試。
//
// - WAV：聲音是一整塊 PCM，依位元組換算時間，直接切
// - MP3：一連串獨立的音訊框，在音訊框的邊界切開，每一段都是可以解碼的 MP3
// - MP4、M4A、MOV：AAC 的音訊樣本散在檔案裡，位置記在 moov 的索引，取出之後交給
//   WebCodecs 的 AudioDecoder

// 可以分段解碼的格式，超過 256 MB 的檔案也能處理（src/tools/index.ts 的 acceptsLarge）。
// MP4、M4A、MOV 要瀏覽器支援 WebCodecs 的 AudioDecoder，不支援時整檔解碼
export const STREAMABLE: readonly Format[] = ["wav", "mp3", "mp4", "m4a", "mov"];

// --- WAV ---

export interface WavLayout {
  sampleRate: number;
  channels: number;
  bits: number; // 8、16、24、32
  float: boolean;
  dataStart: number;
  dataLength: number;
}

const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32le = (b: Uint8Array, i: number) => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

// head 是檔案的開頭（讀前 64 KB 就夠，fmt 與 data 的標頭都在前面）。size 是整個檔案的大小，
// data 的長度寫錯或寫成 0 的（錄到一半斷掉的檔案）用檔案大小推算
export function wavLayout(head: Uint8Array, size: number): WavLayout | null {
  if (ascii(head, 0, 4) !== "RIFF" || ascii(head, 8, 4) !== "WAVE") return null;
  let fmt: Omit<WavLayout, "dataStart" | "dataLength"> | null = null;
  let at = 12;
  while (at + 8 <= head.length) {
    const id = ascii(head, at, 4);
    const length = u32le(head, at + 4);
    if (id === "fmt ") {
      let tag = u16le(head, at + 8);
      // WAVE_FORMAT_EXTENSIBLE：真正的格式在子格式 GUID 的前兩個位元組
      if (tag === 0xfffe && length >= 40) tag = u16le(head, at + 32);
      if (tag !== 1 && tag !== 3) return null;
      fmt = { channels: u16le(head, at + 10), sampleRate: u32le(head, at + 12), bits: u16le(head, at + 22), float: tag === 3 };
    } else if (id === "data") {
      if (!fmt || !fmt.channels || !fmt.sampleRate || ![8, 16, 24, 32].includes(fmt.bits)) return null;
      const dataStart = at + 8;
      const frame = (fmt.bits / 8) * fmt.channels;
      let dataLength = length && dataStart + length <= size ? length : size - dataStart;
      dataLength -= dataLength % frame;
      return { ...fmt, dataStart, dataLength };
    }
    at += 8 + length + (length & 1);
  }
  return null;
}

// PCM 轉成浮點數，每個聲道一個陣列
export function pcmToFloat(bytes: Uint8Array, layout: WavLayout): Float32Array[] {
  const width = layout.bits / 8;
  const frames = Math.floor(bytes.length / (width * layout.channels));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = Array.from({ length: layout.channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < layout.channels; c++) {
      const i = (f * layout.channels + c) * width;
      let v: number;
      if (layout.float) v = layout.bits === 32 ? view.getFloat32(i, true) : 0;
      else if (width === 1) v = (bytes[i]! - 128) / 128;
      else if (width === 2) v = view.getInt16(i, true) / 32768;
      else if (width === 3) v = ((bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)) << 8 >> 8) / 8388608;
      else v = view.getInt32(i, true) / 2147483648;
      out[c]![f] = v;
    }
  }
  return out;
}

// --- MP3 ---

export interface Mp3Frame {
  at: number; // 在檔案裡的位置
  length: number;
  samples: number; // 這一框的取樣數（MPEG-1 是 1152，MPEG-2 與 2.5 是 576）
  rate: number;
}

const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// 從 bytes 的 from 開始（bytes 在檔案裡的位置是 base）連續讀音訊框，讀到不完整的框或不是
// 音訊框為止。回傳讀到的框與下一個要讀的位置（檔案裡的位置）
export function mp3Frames(bytes: Uint8Array, base: number, from = 0): { frames: Mp3Frame[]; next: number } {
  const frames: Mp3Frame[] = [];
  let i = from;
  if (i === 0 && base === 0) i = id3v2Size(bytes, 0);
  while (i + 4 <= bytes.length) {
    const length = mp3FrameLength(bytes, i);
    if (!length) {
      // 音訊框之間偶爾夾著雜訊，往後找下一個同步字
      let j = i + 1;
      while (j + 4 <= bytes.length && !mp3FrameLength(bytes, j)) j++;
      if (j + 4 > bytes.length) break;
      i = j;
      continue;
    }
    if (i + length > bytes.length) break;
    const version = (bytes[i + 1]! >> 3) & 3;
    const rate = MP3_RATES[version]![(bytes[i + 2]! >> 2) & 3]!;
    frames.push({ at: base + i, length, samples: version === 3 ? 1152 : 576, rate });
    i += length;
  }
  return { frames, next: base + i };
}

// --- MP4、M4A、MOV 的 AAC 音軌 ---

export interface AacTrack {
  codec: string; // WebCodecs 的 codec 字串，例如 mp4a.40.2
  config: Uint8Array; // AudioSpecificConfig
  sampleRate: number;
  channels: number;
  timescale: number;
  duration: number; // 秒
  samples: { at: number; size: number; time: number }[]; // time 是秒
}

const payload = (box: Box) => box.start + box.header;
const childOf = (bytes: Uint8Array, box: Box, type: string) => readBoxes(bytes, payload(box), box.end).find((b) => b.type === type);

// MPEG-4 描述子的長度：每個位元組 7 個位元，最高位元是 1 表示還有下一個
function descriptor(bytes: Uint8Array, at: number, end: number): { tag: number; start: number; end: number } | null {
  if (at + 2 > end) return null;
  const tag = bytes[at]!;
  let size = 0;
  let i = at + 1;
  for (let k = 0; k < 4 && i < end; k++) {
    const b = bytes[i++]!;
    size = (size << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return i + size <= end ? { tag, start: i, end: i + size } : null;
}

// esds 裡的 DecoderConfigDescriptor：物件類型 0x40 是 AAC，DecoderSpecificInfo 是 AudioSpecificConfig
function esdsConfig(bytes: Uint8Array, esds: Box): Uint8Array | null {
  const es = descriptor(bytes, payload(esds) + 4, esds.end);
  if (!es || es.tag !== 3) return null;
  const flags = bytes[es.start + 2]!;
  let at = es.start + 3;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) at += 1 + bytes[at]!;
  if (flags & 0x20) at += 2;
  const dc = descriptor(bytes, at, es.end);
  if (!dc || dc.tag !== 4 || bytes[dc.start] !== 0x40) return null;
  const dsi = descriptor(bytes, dc.start + 13, dc.end);
  return dsi && dsi.tag === 5 ? bytes.slice(dsi.start, dsi.end) : null;
}

// moov 讀進記憶體之後（bytes 從 moov 的開頭算起），找第一條聲音軌。只支援 AAC，其他回傳 null
export function aacTrack(bytes: Uint8Array): AacTrack | null {
  const moov = readBoxes(bytes, 0, bytes.length).find((b) => b.type === "moov");
  if (!moov) return null;
  for (const trak of readBoxes(bytes, payload(moov), moov.end).filter((b) => b.type === "trak")) {
    const mdia = childOf(bytes, trak, "mdia");
    const hdlr = mdia && childOf(bytes, mdia, "hdlr");
    if (!mdia || !hdlr || ascii(bytes, payload(hdlr) + 8, 4) !== "soun") continue;
    const mdhd = childOf(bytes, mdia, "mdhd");
    const stbl = childOf(bytes, mdia, "minf") && childOf(bytes, childOf(bytes, mdia, "minf")!, "stbl");
    const stsd = stbl && childOf(bytes, stbl, "stsd");
    const stts = stbl && childOf(bytes, stbl, "stts");
    if (!mdhd || !stbl || !stsd || !stts) continue;
    const v1 = bytes[payload(mdhd)] === 1;
    const timescale = u32be(bytes, payload(mdhd) + (v1 ? 20 : 12));
    const duration = v1 ? u32be(bytes, payload(mdhd) + 24) * 2 ** 32 + u32be(bytes, payload(mdhd) + 28) : u32be(bytes, payload(mdhd) + 16);

    // 聲音的 sample entry：通用的 8 位元組、版本與聲道等 20 位元組，QuickTime 的版本 1、2 再多 16、36 位元組
    const entry = readBoxes(bytes, payload(stsd) + 8, stsd.end)[0];
    if (!entry || entry.type !== "mp4a") return null;
    const fields = payload(entry) + 8;
    const version = u16be(bytes, fields);
    const channels = u16be(bytes, fields + 8);
    const sampleRate = u32be(bytes, fields + 16) >>> 16;
    const children = fields + 20 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    // QuickTime 的 MOV 常把 esds 包在 wave 裡
    const boxes = readBoxes(bytes, children, entry.end);
    const wave = boxes.find((b) => b.type === "wave");
    const esds = boxes.find((b) => b.type === "esds") ?? (wave && childOf(bytes, wave, "esds"));
    const config = esds && esdsConfig(bytes, esds);
    if (!config || !config.length) return null;
    let aot = config[0]! >> 3;
    if (aot === 31 && config.length > 1) aot = 32 + (((config[0]! & 7) << 3) | (config[1]! >> 5));

    // 每個樣本的時間：stts 是一串（個數, 長度）
    const times: number[] = [];
    let t = 0;
    const count = u32be(bytes, payload(stts) + 4);
    for (let i = 0; i < count; i++) {
      const n = u32be(bytes, payload(stts) + 8 + i * 8);
      const delta = u32be(bytes, payload(stts) + 12 + i * 8);
      for (let k = 0; k < n; k++, t += delta) times.push(t / timescale);
    }
    const samples = sampleRanges(bytes, stbl).map(([at, size], i) => ({ at, size, time: times[i] ?? t / timescale }));
    return { codec: `mp4a.40.${aot}`, config, sampleRate, channels, timescale, duration: duration / timescale, samples };
  }
  return null;
}

import { mimetypeKind, ooxmlKind } from "./documents.ts";
import { type ArchiveFormat, archiveKind } from "./archive.ts";
import { type MediaFormat, mediaKind } from "./media.ts";
import { zipNames } from "./zip.ts";

// 處理位元組的小工具。工具模組只依賴這裡與 tool.ts，不碰 DOM，
// 網頁版、Web Worker 與之後的瀏覽器擴充套件都能共用。

export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  const end = Math.min(bytes.length, start + length);
  for (let i = start; i < end; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}

export function startsWith(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function indexOf(bytes: Uint8Array, needle: string, from = 0): number {
  const first = needle.charCodeAt(0);
  const last = bytes.length - needle.length;
  for (let i = from; i <= last; i++) {
    if (bytes[i] === first && startsWith(bytes, i, needle)) return i;
  }
  return -1;
}

export function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at]! << 8) | bytes[at + 1]!;
}

export function u32be(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) >>> 0) + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!);
}

// 從檔案開頭的特徵判斷格式，不相信副檔名與瀏覽器給的 MIME type。
export type Format =
  | "jpeg"
  | "png"
  | "heic"
  | "avif"
  | "gif"
  | "webp"
  | "tiff"
  | "bmp"
  | "pnm"
  | "svg"
  | "jxl"
  | "docx"
  | "xlsx"
  | "pptx"
  | "odt"
  | "ods"
  | "odp"
  | "odg"
  | "pdf"
  | MediaFormat
  | "epub"
  | "zip"
  | ArchiveFormat
  | "age"
  | "unknown";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniff(bytes: Uint8Array): Format {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "png";
  const heif = heifKind(bytes);
  if (heif) return heif;
  if (startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a")) return "gif";
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) return "webp";
  if (startsWith(bytes, 0, "II*\0") || startsWith(bytes, 0, "MM\0*")) return "tiff";
  if (startsWith(bytes, 0, "BM") && bytes.length >= 26 && u32le(bytes, 2) <= bytes.length + 2) return "bmp";
  if (bytes[0] === 0x50 && bytes[1]! >= 0x31 && bytes[1]! <= 0x37 && [0x20, 0x09, 0x0a, 0x0d].includes(bytes[2]!)) return "pnm";
  if ((bytes[0] === 0xff && bytes[1] === 0x0a) || startsWith(bytes, 0, "\0\0\0\x0cJXL \r\n\x87\n")) return "jxl";
  if (looksLikeSvg(bytes)) return "svg";
  if (startsWith(bytes, 0, "%PDF-")) return "pdf";
  // Office 與 ODF 都是 zip，看裡面的檔案
  const names = zipNames(bytes);
  if (names) {
    const kind = ooxmlKind(names) ?? mimetypeKind(bytes);
    if (kind) return kind;
    // 其他 Office 與 ODF 的變體（有巨集的 docm、範本）不當成一般的壓縮檔，免得只清了外殼
    if (names.includes("[Content_Types].xml") || names[0] === "mimetype") return "unknown";
    return "zip";
  }
  const media = mediaKind(bytes);
  if (media) return media;
  const archive = archiveKind(bytes);
  if (archive) return archive;
  // age 的二進位格式與 ASCII armor 文字格式
  if (startsWith(bytes, 0, "age-encryption.org/v1\n") || startsWith(bytes, 0, "-----BEGIN AGE ENCRYPTED FILE-----")) return "age";
  return "unknown";
}

export function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

// HEIF 家族：ftyp box 的品牌。AVIF 用的是同一種容器，品牌是 avif 或 avis
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIF_GENERIC = new Set(["mif1", "msf1"]);

export function heifKind(bytes: Uint8Array): "heic" | "avif" | null {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return null;
  const size = u32be(bytes, 0);
  if (size < 16 || size > bytes.length) return null;
  const major = ascii(bytes, 8, 4);
  if (AVIF_BRANDS.has(major)) return "avif";
  if (HEIC_BRANDS.has(major)) return "heic";
  const compat: string[] = [];
  for (let i = 16; i + 4 <= size; i += 4) compat.push(ascii(bytes, i, 4));
  if (compat.some((b) => AVIF_BRANDS.has(b))) return "avif";
  if (compat.some((b) => HEIC_BRANDS.has(b)) || HEIF_GENERIC.has(major) || compat.some((b) => HEIF_GENERIC.has(b))) return "heic";
  return null;
}

export const isHeifBrand = (bytes: Uint8Array) => heifKind(bytes) !== null;

// SVG 是文字檔：開頭（略過 BOM、空白、XML 宣告與註解）看得到 <svg
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).replace(/^\uFEFF/, "").trimStart();
  if (!head.startsWith("<")) return false;
  return /<svg[\s>]/.test(head) && /^<(\?xml|!--|!DOCTYPE|svg)/i.test(head);
}

// 圖片類的格式。瀏覽器能不能直接顯示因格式而異（HEIC、TIFF、JXL 多半只有 Safari），
// 顯示不出來時預覽改成說明，中繼資料照樣能處理
export const isPhoto = (format: Format) =>
  ["jpeg", "png", "heic", "avif", "gif", "webp", "tiff", "bmp", "pnm", "svg", "jxl"].includes(format);

// 音訊與影片：瀏覽器播得了就給播放器，播不了照樣能檢查與清除
export const AUDIO_FORMATS: readonly Format[] = ["mp3", "m4a", "wav", "flac", "ogg", "opus"];
export const VIDEO_FORMATS: readonly Format[] = ["mp4", "mov", "avi", "mkv", "webm"];
export const isMedia = (format: Format) => AUDIO_FORMATS.includes(format) || VIDEO_FORMATS.includes(format);

export const MIME: Record<Format, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  avif: "image/avif",
  gif: "image/gif",
  webp: "image/webp",
  tiff: "image/tiff",
  bmp: "image/bmp",
  pnm: "image/x-portable-anymap",
  svg: "image/svg+xml",
  jxl: "image/jxl",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  odg: "application/vnd.oasis.opendocument.graphics",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  wav: "audio/wav",
  avi: "video/x-msvideo",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mkv: "video/x-matroska",
  webm: "video/webm",
  epub: "application/epub+zip",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  torrent: "application/x-bittorrent",
  html: "text/html",
  age: "application/octet-stream",
  unknown: "application/octet-stream",
};

export const EXTENSION: Record<Format, string> = {
  jpeg: "jpg",
  png: "png",
  heic: "heic",
  avif: "avif",
  gif: "gif",
  webp: "webp",
  tiff: "tiff",
  bmp: "bmp",
  pnm: "ppm",
  svg: "svg",
  jxl: "jxl",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  odt: "odt",
  ods: "ods",
  odp: "odp",
  odg: "odg",
  pdf: "pdf",
  mp3: "mp3",
  m4a: "m4a",
  mp4: "mp4",
  mov: "mov",
  wav: "wav",
  avi: "avi",
  flac: "flac",
  ogg: "ogg",
  opus: "opus",
  mkv: "mkv",
  webm: "webm",
  epub: "epub",
  zip: "zip",
  tar: "tar",
  gz: "gz",
  torrent: "torrent",
  html: "html",
  age: "age",
  unknown: "bin",
};

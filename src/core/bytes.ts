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
export type Format = "jpeg" | "png" | "age" | "unknown";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniff(bytes: Uint8Array): Format {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "png";
  // age 的二進位格式與 ASCII armor 文字格式
  if (startsWith(bytes, 0, "age-encryption.org/v1\n") || startsWith(bytes, 0, "-----BEGIN AGE ENCRYPTED FILE-----")) return "age";
  return "unknown";
}

export const MIME: Record<Format, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  age: "application/octet-stream",
  unknown: "application/octet-stream",
};

export const EXTENSION: Record<Format, string> = {
  jpeg: "jpg",
  png: "png",
  age: "age",
  unknown: "bin",
};

import jsQR from "jsqr";
import { inflateSync } from "node:zlib";

// 把 src/core/png-encode.ts 產生的 1 位元灰階 PNG 讀回像素，再用 jsQR 解出文字。
// 只支援那一種格式，用來驗證產生的 QR code 掃得出原本的內容。
export function decodeQrPng(png: Uint8Array): string | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (data[8] !== 1 || data[9] !== 0) throw new Error("not 1-bit grayscale");
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width / 8);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1);
    if (raw[row] !== 0) throw new Error("unexpected filter");
    for (let x = 0; x < width; x++) {
      const white = (raw[row + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1;
      const i = (y * width + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = white ? 255 : 0;
      rgba[i + 3] = 255;
    }
  }
  return jsQR(rgba, width, height)?.data ?? null;
}

// 從圖片或相機畫面讀出 QR code 與條碼。jsQR 在第一次用到時才載入。
//
// 先用 jsQR 讀 QR code，讀不到再交給 zxing-wasm 找其他條碼（登機證的 PDF417 與 Aztec、
// 商品條碼、Code 128 這類，src/ui/zxing.ts）。QR code 留給 jsQR：不需要 WebAssembly，
// 鎖定模式下照樣能用，下面為翻拍螢幕做的縮小也是針對它調整的。
//
// 大張的照片先縮小再讀，1200 萬畫素直接丟給 jsQR 要好幾秒。縮小後讀不到，再減半
// 讀兩次，最後用比較大的尺寸試一次，照片裡的 QR code 可能只佔一小塊。
//
// 減半是為了翻拍螢幕的照片。白底上會拍到螢幕子像素的直紋，jsQR 依區塊的明暗決定
// 黑白，紋路在白底上被當成一格格黑點而讀不出來。把相鄰的像素平均，紋路就消失了。
// 縮小由這裡自己平均像素，不交給 canvas：WebKit（iPhone 上的每個瀏覽器）縮圖時
// 只取樣部分像素，縮到多小紋路都還在。

import { assertCanvasReadable, canvasReadable } from "./canvas-access.ts";
import { decodeImage } from "./image-decode.ts";
import { qrText } from "../tools/qr-read/index.ts";
import { type BarcodeFormats, readBarcode } from "./zxing.ts";

type Decode = (data: Uint8ClampedArray, width: number, height: number) => Parameters<typeof qrText>[0] | null;
type Pixels = { data: Uint8ClampedArray; width: number; height: number };

let jsQR: Promise<Decode> | null = null;
const loadJsQR = () => (jsQR ??= import("jsqr").then((m) => m.default as unknown as Decode));

const CAPTURE_MAX = 4096; // iOS 的 canvas 面積上限約 1677 萬像素，長邊 4096 的 4:3 照片放得下
const MIN_SIDE = 250; // 減半到長邊比這個小就不再讀，QR code 的格子會小於兩個像素

// 畫到 canvas 上取出像素，長邊超過 max 時由 canvas 縮小
function capture(source: CanvasImageSource, width: number, height: number, max: number): Pixels {
  const scale = Math.min(1, max / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // 透明的 PNG 底色當白色，否則黑色的碼畫在透明底上讀不出來
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// 每 f×f 個像素平均成一個，除不盡的邊緣捨去
function shrink(src: Pixels, f: number): Pixels {
  if (f <= 1) return src;
  const width = Math.max(1, Math.floor(src.width / f));
  const height = Math.max(1, Math.floor(src.height / f));
  const data = new Uint8ClampedArray(width * height * 4);
  const n = f * f;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * src.width + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) {
          r += src.data[i]!;
          g += src.data[i + 1]!;
          b += src.data[i + 2]!;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

function read(decode: Decode, img: Pixels): string | null {
  // 雜訊偶爾會被讀成一個內容是空的 QR code，當成沒讀到。Big5 的內容由 qrText 自己解
  const result = decode(img.data, img.width, img.height);
  return result ? qrText(result) || null : null;
}

// 縮到長邊不超過 max 再讀，讀不到就逐級減半
function readHalving(decode: Decode, full: Pixels, max: number): string | null {
  let img = shrink(full, Math.ceil(Math.max(full.width, full.height) / max));
  for (;;) {
    const found = read(decode, img);
    if (found) return found;
    if (Math.max(img.width, img.height) / 2 < MIN_SIDE) return null;
    img = shrink(img, 2);
  }
}

function readQrFromPixels(decode: Decode, full: Pixels): string | null {
  const found = readHalving(decode, full, 1200);
  const side = Math.max(full.width, full.height);
  if (found || side <= 1200) return found;
  return read(decode, shrink(full, Math.ceil(side / 3000)));
}

async function pixelsOf(blob: Blob): Promise<Pixels | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(blob);
  } catch {
    return null;
  }
  try {
    return capture(bitmap, bitmap.width, bitmap.height, CAPTURE_MAX);
  } finally {
    bitmap.close();
  }
}

// 瀏覽器不讓讀取 canvas 時丟出 CanvasBlockedError（見 canvas-access.ts）
export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  assertCanvasReadable();
  const decode = await loadJsQR();
  const full = await pixelsOf(blob);
  return full ? readQrFromPixels(decode, full) : null;
}

// 面對面傳送的配對只用 QR code
export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !canvasReadable()) return null;
  const decode = await loadJsQR();
  // 對著螢幕掃描時也會拍到直紋，一樣逐級減半
  return readHalving(decode, capture(video, video.videoWidth, video.videoHeight, 800), 800);
}

// 讀到的內容與條碼的種類（zxing 的名稱，QR code 是 QRCode）
export interface Scanned {
  text: string;
  format: string;
}

// 讀取工具找所有的條碼。暫存區的圖片自動讀取時不找商品條碼：照片裡常拍到包裝，
// 列出一串商品編號沒有幫助
export const ALL_FORMATS: BarcodeFormats = ["AllReadable"];
export const PRIVATE_FORMATS: BarcodeFormats = ["PDF417", "Aztec", "DataMatrix", "Code128", "Code39", "QRCode", "MicroQRCode"];

async function readOther(pixels: Pixels, formats: BarcodeFormats): Promise<Scanned | null> {
  const result = await readBarcode(pixels as ImageData, formats);
  if (!result) return null;
  // zxing 不認得 Big5，解出替代字元時改用位元組自己解（同 qrText）
  const text = result.text.includes("\uFFFD") ? new TextDecoder("big5").decode(result.bytes) : result.text;
  return text ? { text, format: result.format } : null;
}

export async function decodeCodeFromBlob(blob: Blob, formats = ALL_FORMATS): Promise<Scanned | null> {
  assertCanvasReadable();
  const decode = await loadJsQR();
  const full = await pixelsOf(blob);
  if (!full) return null;
  const qr = readQrFromPixels(decode, full);
  if (qr) return { text: qr, format: "QRCode" };
  return readOther(full, formats);
}

// 一維條碼要比較高的解析度，zxing 用的畫面比 jsQR 大
export async function decodeCodeFromVideo(video: HTMLVideoElement): Promise<Scanned | null> {
  const qr = await decodeQrFromVideo(video);
  if (qr) return { text: qr, format: "QRCode" };
  if (!video.videoWidth || !canvasReadable()) return null;
  return readOther(capture(video, video.videoWidth, video.videoHeight, 1600), ALL_FORMATS);
}

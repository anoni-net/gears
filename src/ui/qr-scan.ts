// 從圖片或相機畫面讀出 QR code。jsQR 在第一次用到時才載入。
//
// 大張的照片先縮小再讀，1200 萬畫素直接丟給 jsQR 要好幾秒。縮小後讀不到，再用
// 比較大的尺寸試一次，照片裡的 QR code 可能只佔一小塊。

import { decodeImage } from "./image-decode.ts";

type Decode = (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null;

let jsQR: Promise<Decode> | null = null;
const loadJsQR = () => (jsQR ??= import("jsqr").then((m) => m.default as unknown as Decode));

function pixels(source: CanvasImageSource, width: number, height: number, max: number): ImageData {
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

export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  const decode = await loadJsQR();
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(blob);
  } catch {
    return null;
  }
  try {
    for (const max of [1200, 3000]) {
      const img = pixels(bitmap, bitmap.width, bitmap.height, max);
      const found = decode(img.data, img.width, img.height);
      if (found) return found.data;
      if (Math.max(bitmap.width, bitmap.height) <= max) break;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth) return null;
  const decode = await loadJsQR();
  const img = pixels(video, video.videoWidth, video.videoHeight, 800);
  return decode(img.data, img.width, img.height)?.data ?? null;
}

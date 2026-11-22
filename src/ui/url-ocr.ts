import type { Box } from "../tools/redact/index.ts";
import type { LineText } from "../tools/redact/pii.ts";
import { urlsFromLines } from "../tools/url-check/ocr.ts";

// 從截圖讀出網址：文字辨識（src/ui/redact-detect.ts 的 findText）讀出的每一行交給 src/tools/url-check/ocr.ts 整理，
// 每個網址在截圖上的那一塊畫成裁切小圖，讀者對照著確認每個字。網址檢查的「從截圖讀出網址」與
// 檔案畫面的「畫面上的網址」共用

export interface FoundUrl {
  text: string;
  box: Box;
  // 截圖上的那一塊，在關掉圖片之前畫好。只畫、不讀回像素，Brave 擾動讀出來的像素也不影響
  crop: HTMLCanvasElement;
}

// 裁切小圖最寬幾個像素：長網址在電腦的截圖上可能有兩千多像素寬，縮小一點，字仍然看得清楚
const MAX_CROP = 1200;

function crop(bitmap: ImageBitmap, box: Box): HTMLCanvasElement {
  // 上下多留半個字高、左右多留一個字寬，看得到網址前後的字（全形標點、換行的地方）
  const lineH = Math.min(box.h, 80);
  const x = Math.max(0, Math.floor(box.x - lineH));
  const y = Math.max(0, Math.floor(box.y - lineH / 2));
  const w = Math.min(bitmap.width, Math.ceil(box.x + box.w + lineH)) - x;
  const h = Math.min(bitmap.height, Math.ceil(box.y + box.h + lineH / 2)) - y;
  const scale = Math.min(1, MAX_CROP / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ocr 是 findText 的 ocr（照辨識原文的每一行）
export function urlsInImage(bitmap: ImageBitmap, ocr: LineText[]): FoundUrl[] {
  return urlsFromLines(ocr).map((u) => ({ ...u, crop: crop(bitmap, u.box) }));
}

// 整張圖讀出的文字，一行一行接起來，讀者複製之後拿去別處搜尋
export const ocrText = (ocr: LineText[]) =>
  ocr
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join("\n");

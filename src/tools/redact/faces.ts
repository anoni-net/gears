import type { Box } from "./index.ts";

// 找人臉時的切塊與合併。偵測本身在 src/ui/redact-detect.ts，這裡只有座標的計算，
// 可以在 Node 裡測試。
//
// BlazeFace 的短距離模型以 128 像素的縮圖偵測，臉要佔畫面的一成以上才認得出來，
// 大合照裡的小臉會漏掉。所以整張圖偵測一次，再切成 2×2、4×4、8×8 的區塊（彼此重疊）
// 各偵測一次，合併重疊的結果。切法跟著照片的比例走：1440 像素寬、四十幾個人的合照，
// 最細的區塊約 180 像素，每張 30 像素的臉約佔區塊的六分之一。區塊小於 120 像素就不再切
const GRIDS = [1, 2, 4, 8];
const MIN_TILE = 120;
const OVERLAP = 0.25;

// 切塊之後的區塊容易把衣服上的圖案、按鈕當成臉，門檻比整張圖的 0.5 高一點。
// 實測大合照裡 30 像素的臉分數多在 0.64 以上，太空衣上的按鈕在 0.5 到 0.59
export const TILE_MIN_SCORE = 0.6;

export interface Tile extends Box {
  grid: number; // 切成 grid×grid，1 是整張圖
}

export function faceTiles(width: number, height: number): Tile[] {
  const tiles: Tile[] = [];
  for (const n of GRIDS) {
    if (n > 1 && Math.max(width, height) / n < MIN_TILE) break;
    const w = Math.min(width, Math.ceil((width / n) * (n > 1 ? 1 + OVERLAP : 1)));
    const h = Math.min(height, Math.ceil((height / n) * (n > 1 ? 1 + OVERLAP : 1)));
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x = Math.max(0, Math.min(width - w, Math.floor((width / n) * col)));
        const y = Math.max(0, Math.min(height - h, Math.floor((height / n) * row)));
        tiles.push({ grid: n, x, y, w, h });
      }
    }
  }
  return tiles;
}

const area = (b: Box) => b.w * b.h;

function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (area(a) + area(b) - w * h);
}

const contains = (outer: Box, inner: Box) => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx > outer.x && cx < outer.x + outer.w && cy > outer.y && cy < outer.y + outer.h && area(outer) > area(inner) * 2;
};

// 不同區塊找到的同一張臉只留分數最高的（IoU 超過 0.3 算同一張）。
// 同時包住兩張以上臉的大框是誤判，拿掉
export function mergeFaces(found: { box: Box; score: number }[]): Box[] {
  const kept: Box[] = [];
  for (const { box } of [...found].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => iou(k, box) > 0.3)) kept.push(box);
  }
  return kept.filter((b) => kept.filter((k) => k !== b && contains(b, k)).length < 2);
}

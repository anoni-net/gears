import type { Box } from "./index.ts";

// 找人臉時的切塊與合併。偵測本身在 src/ui/redact-detect.ts，這裡只有座標的計算，
// 可以在 Node 裡測試。
//
// BlazeFace 的短距離模型以 128 像素的縮圖偵測，臉要佔畫面的一成以上才認得出來，
// 大合照裡的小臉會漏掉。所以整張圖偵測一次，再切成 2×2、4×4、8×8、12×12 的區塊（彼此重疊）
// 各偵測一次，合併重疊的結果。切法跟著照片的比例走：1440 像素寬、四十幾個人的合照，
// 最細的區塊約 150 像素，每張 30 像素的臉約佔區塊的五分之一。區塊小於 120 像素就不再切
const GRIDS = [1, 2, 4, 8, 12];
const MIN_TILE = 120;
const OVERLAP = 0.25;

// 衣服上的圖案、按鈕與婚紗的皺褶容易被當成臉，這類誤判多半只在某一種切法出現。
// 分數低於這個值的，要在另一種切法的同一個位置也找到才算，整張圖偵測的那一次也一樣
// （婚紗照的整張圖偵測曾把裙襬認成 0.55 分的大臉）。實測九張照片（大合照、三人合照、
// 特寫、翻拍、婚紗照、臉佔滿畫面的自拍），找到的臉跟所有切法加起來一樣多，誤判是零。
// 自拍的臉在整張圖偵測時都有 0.9 分以上，不需要其他切法確認
export const CONFIRMED_SCORE = 0.85;

export interface Detection {
  box: Box;
  score: number;
  grid: number; // 在哪一種切法找到的
}

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

// 篩選與合併：分數不夠高的要有另一種切法確認。不同區塊找到的同一張臉只留
// 分數最高的（IoU 超過 0.3 算同一張）。同時包住兩張以上臉的大框是誤判，拿掉
export function mergeFaces(found: Detection[]): Box[] {
  const confirmed = found.filter(
    (d) => d.score >= CONFIRMED_SCORE || found.some((o) => o.grid !== d.grid && iou(o.box, d.box) > 0.3),
  );
  const kept: Box[] = [];
  for (const { box } of confirmed.sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => iou(k, box) > 0.3)) kept.push(box);
  }
  return kept.filter((b) => kept.filter((k) => k !== b && contains(b, k)).length < 2);
}

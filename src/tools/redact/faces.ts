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

// 分數夠高的直接採用。衣服上的圖案、招牌的字與花叢也常被認成臉，分數多在 0.5 到 0.75，
// 跟歪著頭、被手遮住一半的真臉差不多，只看分數分不開。所以分數不夠高的再做兩道檢查：
//
// 1. 特徵點要像一張臉：BlazeFace 給的兩眼連線傾斜在 35° 以內，嘴巴在兩眼下方至少
//    框高的 0.28。實測 230 個真臉的偵測都在範圍內，誤判常常歪斜或把嘴巴擠在眼睛旁邊
// 2. 重新偵測：以它為中心裁一塊（框的 2 倍與 3 倍，各加左右翻轉），依兩眼的連線轉正
//    之後再偵測，四次都在 0.6 分以上才算。真臉擺在畫面中間、轉正之後幾乎都認得出來，
//    實測 95 個真臉的候選有 93 個四次都過，65 個誤判沒有一個四次都過
//
// 重新偵測沒過、但有另一種切法在同一個位置也找到的（框的 IoU 超過 0.15），列為「可能是臉」，
// 畫面上用虛線標出、由讀者決定。歪著頭又被手遮住的臉常落在這裡：原始解析度的照片裡
// 分數掉到 0.55，重新偵測過不了，但 4×4 與 12×12 都找到它。花叢與紋路的誤判多半只有一種
// 切法找到，14 張測試照片只多出一個（招牌上的字）
//
// 實測 12 張照片（大合照、婚紗照、店內照片、臉佔滿畫面的自拍、歪著頭又被花瓣遮住嘴的臉），
// 找到的臉跟所有切法加起來一樣多，誤判是零
export const CONFIRMED_SCORE = 0.85;
export const VERIFY_SCORE = 0.6;
export const VERIFY_SCALES = [2, 3]; // 重新偵測時裁切的範圍，框的幾倍
const MAX_EYE_TILT = 35;
const MIN_MOUTH_DROP = 0.28;
const MAYBE_OVERLAP = 0.15;

export interface Detection {
  box: Box;
  score: number;
  grid: number; // 在哪一種切法找到的
  keypoints?: [number, number][]; // 右眼、左眼、鼻子、嘴巴、右耳、左耳
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

// 特徵點的排列像不像一張臉。沒有特徵點時不判斷
function faceLike(d: Detection): boolean {
  const tilt = eyeTilt(d);
  if (tilt === null) return true;
  const [[, ry], [, ly], , [, my]] = d.keypoints as [number, number][];
  return Math.abs(tilt) <= MAX_EYE_TILT && (my - (ry + ly) / 2) / d.box.h >= MIN_MOUTH_DROP;
}

// 兩眼連線的傾斜，-90° 到 90°，重新偵測時依它轉正。沒有特徵點時是 null
export function eyeTilt(d: Detection): number | null {
  const k = d.keypoints;
  if (!k || k.length < 4) return null;
  const [[rx, ry], [lx, ly]] = k as [number, number][];
  let tilt = (Math.atan2(ly - ry, lx - rx) * 180) / Math.PI;
  if (tilt > 90) tilt -= 180;
  if (tilt < -90) tilt += 180;
  return tilt;
}

// 以候選為中心重新偵測，回傳每一次的分數（沒找到是 0）。由 src/ui/redact-detect.ts 提供
export type Verify = (d: Detection) => Promise<number[]>;

export interface FaceSelection {
  faces: Box[]; // 確定的臉，直接加成遮蔽框
  maybe: Box[]; // 可能是臉，讀者決定要不要
}

const centerIn = (inner: Box, outer: Box) => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx > outer.x && cx < outer.x + outer.w && cy > outer.y && cy < outer.y + outer.h;
};
const sameSpot = (a: Box, b: Box) => iou(a, b) > 0.3 || centerIn(a, b) || centerIn(b, a);

// 從分數高的開始看，同一張臉（IoU 超過 0.3）已經有框就跳過，不必再重新偵測。
// 同時包住兩張以上臉的大框是誤判，拿掉
export async function selectFaces(found: Detection[], verify: Verify): Promise<FaceSelection> {
  const kept: Box[] = [];
  const maybe: Box[] = [];
  for (const d of [...found].sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => iou(k, d.box) > 0.3)) continue;
    if (d.score < CONFIRMED_SCORE) {
      if (!faceLike(d)) continue;
      const scores = await verify(d);
      if (!scores.length || scores.some((score) => score < VERIFY_SCORE)) {
        const supported = found.some((o) => o.grid !== d.grid && iou(o.box, d.box) > MAYBE_OVERLAP);
        if (supported && !maybe.some((m) => sameSpot(m, d.box))) maybe.push(d.box);
        continue;
      }
    }
    kept.push(d.box);
  }
  const faces = kept.filter((b) => kept.filter((k) => k !== b && contains(b, k)).length < 2);
  return { faces, maybe: maybe.filter((m) => !faces.some((f) => sameSpot(f, m))) };
}

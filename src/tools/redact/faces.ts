import type { Box } from "./index.ts";

// 找人臉的純邏輯：輸入尺寸、YuNet 輸出的解碼、合併。模型的執行在 src/ui/redact-detect.ts，
// 這裡只有數字的計算，可以在 Node 裡測試。
//
// 模型是 OpenCV 的 YuNet（face_detection_yunet_2023mar，MIT），用 WIDER FACE 的合照訓練，
// 對遮擋、側臉與小臉比 BlazeFace 穩。模型適合約 10 到 300 像素的臉，所以整張圖縮到
// 長邊 960 與 320 各偵測一次：960 抓合照裡的小臉，320 抓佔滿畫面的大臉（960 時超過
// 300 像素，分數會掉到 0.7 上下）。
//
// 實測 14 張照片（大合照、婚紗照、店內照片、臉佔滿畫面的自拍、歪著頭又被花瓣遮住嘴的臉，
// 以及放大加上相機雜訊、模擬原始解析度的版本），71 張臉全部找到、誤判是零。在瀏覽器裡
// 真臉的最低分 0.82，不是臉的最高分 0.55（太空衣上的一隻手），門檻放在中間：0.7 以上直接
// 加成遮蔽框，0.6 到 0.7 畫成虛線的「可能是臉」，由讀者決定
export const SCALES = [960, 320];
export const FACE_SCORE = 0.7;
export const MAYBE_SCORE = 0.6;
const STRIDES = [8, 16, 32];

export interface Detection {
  box: Box;
  score: number;
  keypoints?: [number, number][]; // 影像左眼、影像右眼、鼻尖、影像左嘴角、影像右嘴角
  scale?: number; // 在哪個長邊偵測到的，偵錯輸出用
}

export interface InputSize {
  scale: number; // 原圖乘上這個值是模型輸入的尺寸
  width: number; // 縮放之後的寬高
  height: number;
  padWidth: number; // 補到 32 的倍數，右邊與下面補黑
  padHeight: number;
}

// 長邊縮放到 long，再補到 32 的倍數（模型裡的上採樣固定放大兩倍，寬高要能被 32 整除）
export function inputSize(width: number, height: number, long: number): InputSize {
  const scale = long / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { scale, width: w, height: h, padWidth: Math.ceil(w / 32) * 32, padHeight: Math.ceil(h / 32) * 32 };
}

export type Outputs = Record<string, { data: ArrayLike<number> }>;

// YuNet 2023mar 的輸出：每個 stride（8、16、32）有 cls、obj（形狀 [1, N, 1]，已經過 sigmoid）、
// bbox（[1, N, 4]）與 kps（[1, N, 10]）。N 是格子數，列優先排列，每個格子一個預測，沒有 anchor。
// 分數是 sqrt(cls × obj)，座標是模型輸入（補過黑邊）的像素
export function decodeYunet(outputs: Outputs, padWidth: number, padHeight: number, minScore: number): Detection[] {
  const found: Detection[] = [];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`]?.data;
    const obj = outputs[`obj_${stride}`]?.data;
    const bbox = outputs[`bbox_${stride}`]?.data;
    const kps = outputs[`kps_${stride}`]?.data;
    if (!cls || !obj || !bbox || !kps) throw new Error(`YuNet 的輸出少了 stride ${stride}`);
    const cols = padWidth / stride;
    const cells = cols * (padHeight / stride);
    for (let i = 0; i < cells; i++) {
      const score = Math.sqrt(clamp(cls[i]!) * clamp(obj[i]!));
      if (score < minScore) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const cx = (col + bbox[i * 4]!) * stride;
      const cy = (row + bbox[i * 4 + 1]!) * stride;
      const w = Math.exp(bbox[i * 4 + 2]!) * stride;
      const h = Math.exp(bbox[i * 4 + 3]!) * stride;
      const keypoints: [number, number][] = [];
      for (let k = 0; k < 5; k++) keypoints.push([(kps[i * 10 + k * 2]! + col) * stride, (kps[i * 10 + k * 2 + 1]! + row) * stride]);
      found.push({ box: { x: cx - w / 2, y: cy - h / 2, w, h }, score, keypoints });
    }
  }
  return found;
}

// 模型輸入的座標換回原圖
export function toImage(d: Detection, scale: number): Detection {
  return {
    ...d,
    box: { x: d.box.x / scale, y: d.box.y / scale, w: d.box.w / scale, h: d.box.h / scale },
    keypoints: d.keypoints?.map(([x, y]): [number, number] => [x / scale, y / scale]),
  };
}

const area = (b: Box) => b.w * b.h;

function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (area(a) + area(b) - w * h);
}

const centerIn = (inner: Box, outer: Box) => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx > outer.x && cx < outer.x + outer.w && cy > outer.y && cy < outer.y + outer.h;
};

// 同一張臉：IoU 超過 0.3，或一個框的中心落在另一個框裡（兩種尺寸找到的大臉，框的大小常差很多）
const sameSpot = (a: Box, b: Box) => iou(a, b) > 0.3 || centerIn(a, b) || centerIn(b, a);

const contains = (outer: Box, inner: Box) => centerIn(inner, outer) && area(outer) > area(inner) * 2;

export interface FaceSelection {
  faces: Box[]; // 確定的臉，直接加成遮蔽框
  maybe: Box[]; // 可能是臉，讀者決定要不要
}

// 兩種尺寸的結果合併：同一張臉只留分數最高的。同時包住兩張以上臉的大框是誤判，拿掉
export function selectFaces(found: Detection[]): FaceSelection {
  const kept: Detection[] = [];
  for (const d of [...found].sort((a, b) => b.score - a.score)) {
    if (d.score < MAYBE_SCORE || kept.some((k) => sameSpot(k.box, d.box))) continue;
    kept.push(d);
  }
  const faces = kept.filter((d) => d.score >= FACE_SCORE).map((d) => d.box);
  const sure = faces.filter((b) => faces.filter((k) => k !== b && contains(b, k)).length < 2);
  const maybe = kept.filter((d) => d.score < FACE_SCORE).map((d) => d.box);
  return { faces: sure, maybe: maybe.filter((m) => !sure.some((f) => sameSpot(f, m))) };
}

import { expect, test } from "@playwright/test";
import { type Detection, type Outputs, decodeYunet, inputSize, selectFaces, toImage } from "../../src/tools/redact/faces.ts";

test("輸入尺寸：長邊縮到指定的大小，寬高補到 32 的倍數", () => {
  // 手機拍的直式原始檔
  expect(inputSize(3648, 5472, 960)).toEqual({ scale: 960 / 5472, width: 640, height: 960, padWidth: 640, padHeight: 960 });
  // 1440×1080 的合照
  expect(inputSize(1440, 1080, 960)).toMatchObject({ width: 960, height: 720, padWidth: 960, padHeight: 736 });
  expect(inputSize(1440, 1080, 320)).toMatchObject({ width: 320, height: 240, padWidth: 320, padHeight: 256 });
  // 小圖也放大到指定的長邊，模型對 10 像素以下的臉找不到
  expect(inputSize(300, 200, 960)).toMatchObject({ width: 960, height: 640 });
});

// 64×64 的輸入：stride 8、16、32 各有 64、16、4 個格子，全部填 0，再把指定的格子填上數值
function outputs(cells: { stride: number; index: number; cls: number; obj: number; bbox: number[]; kps?: number[] }[]): Outputs {
  const out: Record<string, { data: Float32Array }> = {};
  for (const stride of [8, 16, 32]) {
    const n = (64 / stride) ** 2;
    out[`cls_${stride}`] = { data: new Float32Array(n) };
    out[`obj_${stride}`] = { data: new Float32Array(n) };
    out[`bbox_${stride}`] = { data: new Float32Array(n * 4) };
    out[`kps_${stride}`] = { data: new Float32Array(n * 10) };
  }
  for (const c of cells) {
    out[`cls_${c.stride}`]!.data[c.index] = c.cls;
    out[`obj_${c.stride}`]!.data[c.index] = c.obj;
    out[`bbox_${c.stride}`]!.data.set(c.bbox, c.index * 4);
    if (c.kps) out[`kps_${c.stride}`]!.data.set(c.kps, c.index * 10);
  }
  return out;
}

test("解碼：分數是 sqrt(cls × obj)，框與特徵點依格子的位置還原", () => {
  const found = decodeYunet(
    outputs([
      // stride 8 的第 9 格：第 1 列第 1 欄
      { stride: 8, index: 9, cls: 0.81, obj: 1, bbox: [0.5, 0.5, Math.log(4), Math.log(5)], kps: [0.25, 0.5, 0.75, 0.5, 0.5, 1, 0.25, 1.5, 0.75, 1.5] },
      // 分數 0.3，低於門檻
      { stride: 16, index: 0, cls: 0.3, obj: 0.3, bbox: [0, 0, 0, 0] },
      // stride 32 的最後一格：第 1 列第 1 欄
      { stride: 32, index: 3, cls: 0.64, obj: 0.64, bbox: [0, 0, 0, 0] },
    ]),
    64,
    64,
    0.5,
  );
  expect(found).toHaveLength(2);
  const [a, b] = found as [Detection, Detection];
  expect(a.score).toBeCloseTo(0.9);
  // 中心 (1.5 × 8, 1.5 × 8) = (12, 12)，寬 4 × 8、高 5 × 8
  expect(a.box.x).toBeCloseTo(-4);
  expect(a.box.y).toBeCloseTo(-8);
  expect(a.box.w).toBeCloseTo(32);
  expect(a.box.h).toBeCloseTo(40);
  expect(a.keypoints![0]![0]).toBeCloseTo(10);
  expect(a.keypoints![0]![1]).toBeCloseTo(12);
  expect(a.keypoints![4]![1]).toBeCloseTo(20);
  expect(b.score).toBeCloseTo(0.64);
  expect(b.box).toEqual({ x: 16, y: 16, w: 32, h: 32 });
});

test("解碼：輸出少了某個 stride 就停下來，不交出不完整的結果", () => {
  const broken = outputs([]);
  delete broken["kps_16"];
  expect(() => decodeYunet(broken, 64, 64, 0.5)).toThrow();
});

test("座標換回原圖", () => {
  const d = toImage({ box: { x: 10, y: 20, w: 30, h: 40 }, score: 0.9, keypoints: [[15, 25]] }, 0.5);
  expect(d.box).toEqual({ x: 20, y: 40, w: 60, h: 80 });
  expect(d.keypoints).toEqual([[30, 50]]);
});

const det = (x: number, y: number, w: number, score: number, h = w): Detection => ({ box: { x, y, w, h }, score });

test("合併：同一張臉在兩種尺寸都找到時只留分數最高的", () => {
  // 臉佔滿畫面的自拍：長邊 320 找到 0.95 的大框，960 找到 0.73 與 0.51 的小框，中心都落在大框裡
  const big = det(100, 100, 775, 0.95);
  const { faces, maybe } = selectFaces([det(250, 300, 469, 0.73), big, det(260, 280, 526, 0.51)]);
  expect(faces).toEqual([big.box]);
  expect(maybe).toEqual([]);
});

test("0.7 以上加成框，0.6 到 0.7 是可能是臉，0.6 以下不要", () => {
  const sure = det(100, 100, 50, 0.9);
  const unsure = det(400, 100, 50, 0.65);
  const { faces, maybe } = selectFaces([sure, unsure, det(700, 100, 50, 0.55)]);
  expect(faces).toEqual([sure.box]);
  expect(maybe).toEqual([unsure.box]);
});

test("同時包住兩張臉的大框拿掉", () => {
  const { faces } = selectFaces([det(100, 100, 30, 0.95), det(200, 100, 30, 0.95), det(80, 60, 200, 0.9, 120)]);
  expect(faces).toHaveLength(2);
});

import { expect, test } from "@playwright/test";
import { faceTiles, mergeFaces } from "../../src/tools/redact/faces.ts";

test("大合照切到 12×12，最細的區塊夠小，30 像素的臉佔得到區塊的五分之一", () => {
  const tiles = faceTiles(1440, 1080);
  expect([...new Set(tiles.map((t) => t.grid))]).toEqual([1, 2, 4, 8, 12]);
  expect(tiles).toHaveLength(1 + 4 + 16 + 64 + 144);
  const finest = tiles.filter((t) => t.grid === 12);
  expect(Math.max(...finest.map((t) => t.w))).toBeLessThanOrEqual(150);
});

test("每一層的區塊蓋住整張圖，彼此重疊，不超出邊界", () => {
  const width = 1440;
  const height = 1080;
  const tiles = faceTiles(width, height);
  for (const n of [2, 4, 8, 12]) {
    const level = tiles.filter((t) => t.grid === n);
    for (const t of level) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(width);
      expect(t.y + t.h).toBeLessThanOrEqual(height);
    }
    // 區塊排成格子，橫向與縱向各自蓋滿就蓋住整張圖
    const covers = (size: number, spans: [number, number][]) => {
      for (let p = 0; p < size; p++) if (!spans.some(([a, b]) => p >= a && p < b)) return false;
      return true;
    };
    expect(covers(width, level.map((t) => [t.x, t.x + t.w]))).toBe(true);
    expect(covers(height, level.map((t) => [t.y, t.y + t.h]))).toBe(true);
    // 相鄰的區塊重疊，切在邊界上的臉至少有一塊是完整的
    const row = level.filter((t) => t.y === level[0]!.y).sort((a, b) => a.x - b.x);
    expect(row[0]!.x + row[0]!.w).toBeGreaterThan(row[1]!.x);
  }
});

test("小圖不切：區塊小於 120 像素就停在上一層", () => {
  expect(faceTiles(200, 150).map((t) => t.grid)).toEqual([1]);
  expect([...new Set(faceTiles(640, 480).map((t) => t.grid))]).toEqual([1, 2, 4]);
});

test("合併：同一張臉留分數最高的，包住兩張臉的大框拿掉", () => {
  const boxes = mergeFaces([
    { box: { x: 100, y: 100, w: 30, h: 30 }, score: 0.7, grid: 1 },
    { box: { x: 102, y: 101, w: 30, h: 30 }, score: 0.9, grid: 4 },
    { box: { x: 200, y: 100, w: 30, h: 30 }, score: 0.88, grid: 1 },
    // 分數夠高、但同時包住兩張臉
    { box: { x: 80, y: 80, w: 200, h: 80 }, score: 0.86, grid: 1 },
  ]);
  expect(boxes).toEqual([
    { x: 102, y: 101, w: 30, h: 30 },
    { x: 200, y: 100, w: 30, h: 30 },
  ]);
});

test("區塊裡分數不夠高的，要另一種切法在同一個位置也找到才算", () => {
  const button = { x: 500, y: 500, w: 20, h: 20 };
  const face = { x: 100, y: 100, w: 30, h: 30 };
  const sharp = { x: 300, y: 100, w: 30, h: 30 };
  const boxes = mergeFaces([
    // 只在 8×8 找到、分數 0.6：衣服上的按鈕
    { box: button, score: 0.6, grid: 8 },
    // 8×8 與 12×12 都找到：小臉
    { box: face, score: 0.6, grid: 8 },
    { box: { ...face, x: 101 }, score: 0.55, grid: 12 },
    // 分數夠高，只有一種切法找到也算
    { box: sharp, score: 0.9, grid: 12 },
  ]);
  expect(boxes).toEqual([sharp, face]);
});

test("整張圖偵測找到的低分大框，沒有其他切法確認也不算", () => {
  const face = { x: 784, y: 957, w: 127, h: 127 };
  // 婚紗照：整張圖偵測把裙襬認成 0.55 分、814 像素的大臉
  const skirt = { x: 378, y: 1195, w: 814, h: 814 };
  const boxes = mergeFaces([
    { box: skirt, score: 0.55, grid: 1 },
    { box: face, score: 0.91, grid: 4 },
  ]);
  expect(boxes).toEqual([face]);
  // 分數夠高的整張圖偵測照樣採用，例如臉佔滿畫面的自拍
  const selfie = { x: 100, y: 100, w: 800, h: 800 };
  expect(mergeFaces([{ box: selfie, score: 0.92, grid: 1 }])).toEqual([selfie]);
});

// 依框的大小擺出特徵點：兩眼在框高 0.35、鼻子 0.55、嘴巴 0.75，tilt 是兩眼連線的傾斜角度
function keypoints(box: { x: number; y: number; w: number; h: number }, tilt = 0): [number, number][] {
  const cx = box.x + box.w / 2;
  const ey = box.y + box.h * 0.35;
  const dx = box.w * 0.2 * Math.cos((tilt * Math.PI) / 180);
  const dy = box.w * 0.2 * Math.sin((tilt * Math.PI) / 180);
  return [
    [cx - dx, ey - dy],
    [cx + dx, ey + dy],
    [cx, box.y + box.h * 0.55],
    [cx, box.y + box.h * 0.75],
  ];
}

test("特徵點不像臉的低分結果不算：兩眼歪斜，或嘴巴擠在眼睛旁邊", () => {
  const sign = { x: 390, y: 533, w: 42, h: 42 };
  const pattern = { x: 600, y: 100, w: 60, h: 60 };
  const flat: [number, number][] = [
    [600 + 15, 120],
    [600 + 45, 120],
    [630, 122],
    [630, 125], // 嘴巴只在眼睛下方框高的 0.08
  ];
  const boxes = mergeFaces([
    { box: sign, score: 0.57, grid: 8, keypoints: keypoints(sign, 42) },
    { box: { ...sign, x: 395, w: 40, h: 40 }, score: 0.58, grid: 12, keypoints: keypoints({ ...sign, x: 395, w: 40, h: 40 }, 42) },
    { box: pattern, score: 0.6, grid: 8, keypoints: flat },
    { box: { ...pattern, x: 602 }, score: 0.6, grid: 12, keypoints: flat.map(([x, y]) => [x + 2, y]) },
  ]);
  expect(boxes).toEqual([]);
});

test("兩種切法的特徵點對不上，不算互相確認", () => {
  const a = { x: 390, y: 533, w: 42, h: 42 };
  const b = { x: 395, y: 535, w: 32, h: 32 };
  // 兩次的特徵點都像臉，但位置差了半個框
  const boxes = mergeFaces([
    { box: a, score: 0.57, grid: 8, keypoints: keypoints(a) },
    { box: b, score: 0.58, grid: 12, keypoints: keypoints(b).map(([x, y]) => [x + 20, y + 10]) },
  ]);
  expect(boxes).toEqual([]);
});

test("歪著頭的小臉：特徵點對得上就算，傾斜 30° 以內不受影響", () => {
  const a = { x: 100, y: 100, w: 40, h: 40 };
  const b = { x: 102, y: 101, w: 38, h: 38 };
  const boxes = mergeFaces([
    { box: a, score: 0.62, grid: 8, keypoints: keypoints(a, 30) },
    { box: b, score: 0.6, grid: 12, keypoints: keypoints(b, 30) },
  ]);
  expect(boxes).toEqual([a]);
});

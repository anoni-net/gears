import { expect, test } from "@playwright/test";
import { type Detection, faceTiles, selectFaces } from "../../src/tools/redact/faces.ts";

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

const face = (x: number, y: number, w: number, score: number, grid = 4, tilt = 0): Detection => {
  const box = { x, y, w, h: w };
  return { box, score, grid, keypoints: keypoints(box, tilt) };
};

// 假的重新偵測：依框的位置給固定的分數，順便記下被重新偵測的框
function verifier(scores: Map<number, number[]>) {
  const calls: number[] = [];
  return {
    calls,
    verify: async (d: Detection) => {
      calls.push(d.box.x);
      return scores.get(d.box.x) ?? [0, 0, 0, 0];
    },
  };
}

test("分數夠高的直接採用，不重新偵測；同一張臉只留分數最高的", async () => {
  const v = verifier(new Map());
  const boxes = await selectFaces([face(100, 100, 30, 0.9), face(102, 101, 30, 0.7, 8), face(200, 100, 30, 0.88)], v.verify);
  expect(boxes).toEqual([
    { x: 100, y: 100, w: 30, h: 30 },
    { x: 200, y: 100, w: 30, h: 30 },
  ]);
  expect(v.calls).toEqual([]);
});

test("分數不夠高的，重新偵測四次都過 0.6 才算", async () => {
  const v = verifier(
    new Map([
      // 歪著頭、嘴巴被手遮住的臉：轉正之後認得出來
      [508, [0.63, 0.79, 0.77, 0.68]],
      // 花叢：有幾次認得出來，但不是每一次
      [177, [0.61, 0, 0.5, 0.66]],
      // 招牌的字
      [390, [0.62, 0, 0.67, 0]],
    ]),
  );
  const boxes = await selectFaces([face(508, 929, 91, 0.7, 4, 31), face(177, 837, 45, 0.65, 12), face(390, 533, 42, 0.57, 8)], v.verify);
  expect(boxes).toEqual([{ x: 508, y: 929, w: 91, h: 91 }]);
  expect(v.calls.sort()).toEqual([177, 390, 508]);
});

test("特徵點不像臉的低分結果不重新偵測：兩眼歪斜，或嘴巴擠在眼睛旁邊", async () => {
  const v = verifier(new Map([[390, [0.9, 0.9, 0.9, 0.9]], [600, [0.9, 0.9, 0.9, 0.9]]]));
  const flat: Detection = {
    box: { x: 600, y: 100, w: 60, h: 60 },
    score: 0.6,
    grid: 8,
    keypoints: [
      [615, 120],
      [645, 120],
      [630, 122],
      [630, 125], // 嘴巴只在眼睛下方框高的 0.08
    ],
  };
  expect(await selectFaces([face(390, 533, 42, 0.57, 8, 42), flat], v.verify)).toEqual([]);
  expect(v.calls).toEqual([]);
});

test("同一張臉已經有框，分數較低的其他偵測不必重新偵測", async () => {
  const v = verifier(new Map());
  await selectFaces([face(753, 926, 109, 0.88), face(751, 933, 107, 0.7, 8), face(777, 933, 103, 0.52, 12)], v.verify);
  expect(v.calls).toEqual([]);
});

test("整張圖偵測的低分大框，重新偵測不過就不算", async () => {
  // 婚紗照：整張圖偵測把裙襬認成 0.55 分、814 像素的大臉
  const v = verifier(new Map([[784, [0.9, 0.9, 0.9, 0.9]]]));
  const boxes = await selectFaces([face(378, 1195, 814, 0.55, 1), face(784, 957, 127, 0.8)], v.verify);
  expect(boxes).toEqual([{ x: 784, y: 957, w: 127, h: 127 }]);
});

test("同時包住兩張臉的大框拿掉", async () => {
  const boxes = await selectFaces([face(100, 100, 30, 0.95), face(200, 100, 30, 0.95), { box: { x: 80, y: 60, w: 200, h: 120 }, score: 0.9, grid: 1 }], verifier(new Map()).verify);
  expect(boxes).toHaveLength(2);
});

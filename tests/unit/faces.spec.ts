import { expect, test } from "@playwright/test";
import { faceTiles, mergeFaces } from "../../src/tools/redact/faces.ts";

test("大合照切到 8×8，最細的區塊夠小，30 像素的臉佔得到區塊的六分之一", () => {
  const tiles = faceTiles(1440, 1080);
  expect([...new Set(tiles.map((t) => t.grid))]).toEqual([1, 2, 4, 8]);
  expect(tiles).toHaveLength(1 + 4 + 16 + 64);
  const finest = tiles.filter((t) => t.grid === 8);
  expect(Math.max(...finest.map((t) => t.w))).toBeLessThanOrEqual(240);
});

test("每一層的區塊蓋住整張圖，彼此重疊，不超出邊界", () => {
  const width = 1440;
  const height = 1080;
  const tiles = faceTiles(width, height);
  for (const n of [2, 4, 8]) {
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
    { box: { x: 100, y: 100, w: 30, h: 30 }, score: 0.7 },
    { box: { x: 102, y: 101, w: 30, h: 30 }, score: 0.9 },
    { box: { x: 200, y: 100, w: 30, h: 30 }, score: 0.8 },
    { box: { x: 80, y: 80, w: 200, h: 80 }, score: 0.6 },
  ]);
  expect(boxes).toEqual([
    { x: 102, y: 101, w: 30, h: 30 },
    { x: 200, y: 100, w: 30, h: 30 },
  ]);
});

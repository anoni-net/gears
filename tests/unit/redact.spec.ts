import { expect, test } from "@playwright/test";
import { boxFromPoints, isDark, isUsable, samplePoints } from "../../src/tools/redact/index.ts";

test("兩個角換成框，任意方向拖都一樣，超出圖片的部分裁掉", () => {
  expect(boxFromPoints(10, 20, 60, 50, 100, 100)).toEqual({ x: 10, y: 20, w: 50, h: 30 });
  expect(boxFromPoints(60, 50, 10, 20, 100, 100)).toEqual({ x: 10, y: 20, w: 50, h: 30 });
  expect(boxFromPoints(-5, -5, 120, 30, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 30 });
  expect(isUsable({ x: 0, y: 0, w: 2, h: 40 })).toBe(false);
});

test("抽查點都落在框內", () => {
  const box = { x: 10, y: 10, w: 40, h: 20 };
  const points = samplePoints(box);
  expect(points).toHaveLength(9);
  for (const [x, y] of points) {
    expect(x).toBeGreaterThanOrEqual(10);
    expect(x).toBeLessThan(50);
    expect(y).toBeGreaterThanOrEqual(10);
    expect(y).toBeLessThan(30);
  }
  expect(samplePoints({ x: 0, y: 0, w: 4, h: 4 }).every(([x, y]) => x < 4 && y < 4)).toBe(true);
  expect(isDark(3, 0, 10)).toBe(true);
  expect(isDark(40, 0, 0)).toBe(false);
});

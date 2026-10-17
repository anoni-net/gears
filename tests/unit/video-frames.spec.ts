import { expect, test } from "@playwright/test";
import { SIZE, type Sample, clock, difference, frameName, isBlank, pickFrames, sampleTimes } from "../../src/tools/video-frames/index.ts";

// 合成的畫面：左半邊亮度 a、右半邊亮度 b，有對比才不會被當成單一顏色
const scene = (a: number, b: number) => Uint8Array.from({ length: SIZE * SIZE }, (_, i) => (i % SIZE < SIZE / 2 ? a : b));
const flat = (v: number) => new Uint8Array(SIZE * SIZE).fill(v);
const samples = (lumas: Uint8Array[]): Sample[] => lumas.map((luma, i) => ({ time: i, luma }));

test("取樣的時間點：間隔平均、取在中間，長片最多 240 個，短片至少間隔半秒", () => {
  expect(sampleTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
  expect(sampleTimes(3600)).toHaveLength(240);
  const short = sampleTimes(2);
  expect(short).toEqual([0.25, 0.75, 1.25, 1.75]);
  expect(sampleTimes(Infinity)).toEqual([0]);
  expect(sampleTimes(0)).toEqual([0]);
});

test("單一顏色的畫面算空白，有對比的不算", () => {
  expect(isBlank(flat(0))).toBe(true);
  expect(isBlank(flat(255))).toBe(true);
  expect(isBlank(scene(20, 200))).toBe(false);
  expect(difference(scene(20, 200), scene(20, 200))).toBe(0);
  expect(difference(flat(0), flat(100))).toBe(100);
});

test("換場景的地方留下來，同一個場景只留一格", () => {
  const a = scene(20, 200);
  const b = scene(200, 20);
  const c = scene(100, 250);
  const times = pickFrames(samples([a, a, a, b, b, c, c, c]), { max: 16, min: 1, threshold: 24 });
  expect(times).toEqual([0, 3, 5]);
});

test("慢慢移動的鏡頭跟上一格留下的比，累積夠多也會留一格", () => {
  // 每一格只差 10，跟前一格比永遠不到門檻，跟上一格留下的比，第 3 格累積到 30
  const lumas = [0, 1, 2, 3, 4, 5, 6].map((i) => scene(20 + i * 10, 200 - i * 10));
  expect(pickFrames(samples(lumas), { max: 16, min: 1, threshold: 24 })).toEqual([0, 3, 6]);
});

test("黑幕與淡出略過，全部都是黑畫面時留中間一格", () => {
  const a = scene(20, 200);
  const b = scene(200, 20);
  expect(pickFrames(samples([flat(0), a, flat(0), b, flat(0)]), { max: 16, min: 1, threshold: 24 })).toEqual([1, 3]);
  expect(pickFrames(samples([flat(0), flat(0), flat(0)]))).toEqual([1]);
});

test("太多時留差距最大的幾格，第一格一定留，依時間排序", () => {
  const lumas = [scene(0, 255), scene(30, 255), scene(130, 255), scene(160, 255), scene(255, 0)];
  // 跟上一格留下的比：30、100、30、大幅反轉
  expect(pickFrames(samples(lumas), { max: 3, min: 1, threshold: 24 })).toEqual([0, 2, 4]);
});

test("畫面幾乎不動的影片，平均補到至少 min 格", () => {
  const still = Array.from({ length: 20 }, () => scene(20, 200));
  const times = pickFrames(samples(still), { max: 16, min: 4, threshold: 24 });
  expect(times).toHaveLength(4);
  expect(times[0]).toBe(0);
  expect(new Set(times).size).toBe(4);
});

test("找到兩個以上的場景就不補，不放進同一個場景的重複畫面", () => {
  const a = scene(20, 200);
  const b = scene(200, 20);
  expect(pickFrames(samples([a, a, a, a, b, b, b, b]), { max: 16, min: 4, threshold: 24 })).toEqual([0, 4]);
});

test("時間與檔名：不沿用影片的檔名", () => {
  expect(clock(65.34)).toBe("1:05.3");
  expect(clock(3725)).toBe("1:02:05.0");
  expect(clock(0)).toBe("0:00.0");
  expect(frameName(65.34)).toBe("frame-1-05.3.jpg");
});

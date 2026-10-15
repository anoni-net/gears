import { expect, test } from "@playwright/test";
import { assignSpeakers, cluster, normalize } from "../../src/tools/transcribe/speakers.ts";

// 固定的亂數，測試結果不隨每次執行變動
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
}

// 每位說話者一個聲紋中心，每段在中心附近加上雜訊
function voices(order: number[], noise = 0.6, seed = 1) {
  const rand = random(seed);
  const centers = Array.from({ length: 4 }, () => Array.from({ length: 192 }, rand));
  return order.map((speaker) => normalize(centers[speaker]!.map((x) => x + rand() * noise)));
}

test("兩個人輪流說話，依第一次開口的順序編號", () => {
  const order = [1, 1, 0, 0, 1, 0, 1, 1, 0, 0];
  const labels = cluster(voices(order), order.map(() => 5));
  expect(labels).toEqual([0, 0, 1, 1, 0, 1, 0, 0, 1, 1]);
});

test("四個人分成四群", () => {
  const order = [0, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 0];
  expect(new Set(cluster(voices(order), order.map(() => 4))).size).toBe(4);
});

test("同一個人的錄音不會被分成好幾個人", () => {
  const order = Array.from({ length: 40 }, () => 0);
  expect(new Set(cluster(voices(order, 1.2), order.map(() => 3))).size).toBe(1);
});

test("總共說不到 10 秒的人，併到聲音最接近的人", () => {
  const order = [0, 0, 0, 1, 1, 1, 2];
  const labels = cluster(voices(order), [5, 5, 5, 5, 5, 5, 2]);
  expect(new Set(labels).size).toBe(2);
});

test("整段錄音都很短時，至少留下一個人", () => {
  expect(cluster(voices([0, 1]), [2, 2])).toEqual([0, 0]);
  expect(cluster([], [])).toEqual([]);
  expect(cluster(voices([0]), [3])).toEqual([0]);
});

test("太短、沒有聲紋的段落沿用前一段的說話者", () => {
  const [a, b, c, d] = voices([0, 0, 1, 1]);
  expect(assignSpeakers([null, a!, b!, null, c!, d!, null], [0.1, 6, 6, 0.2, 6, 6, 0.1])).toEqual([0, 0, 0, 0, 1, 1, 1]);
});

test("兩千段在幾秒內分完", () => {
  const order = Array.from({ length: 2000 }, (_, i) => Math.floor(i / 7) % 3);
  const started = performance.now();
  const labels = cluster(voices(order), order.map(() => 3));
  expect(performance.now() - started).toBeLessThan(15_000);
  expect(new Set(labels).size).toBe(3);
});

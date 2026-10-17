import { expect, test } from "@playwright/test";
import { isFaintYellow, judge, otsuThreshold, removeYellow, revealYellow, toBlackWhite } from "../../src/tools/print-dots/index.ts";

const pixels = (...colors: [number, number, number][]) => new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
const at = (data: Uint8ClampedArray, i: number) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

const DOT: [number, number, number] = [255, 252, 205]; // 追蹤點
const SCANNED_DOT: [number, number, number] = [238, 232, 196]; // 掃描之後偏灰的追蹤點
const HIGHLIGHTER: [number, number, number] = [255, 240, 30]; // 螢光筆
const TEXT: [number, number, number] = [20, 20, 20];
const PAPER: [number, number, number] = [250, 250, 248];

test("淡黃色的追蹤點算進去，螢光筆、白紙、黑字與其他淺色不算", () => {
  expect(isFaintYellow(...DOT)).toBe(true);
  expect(isFaintYellow(...SCANNED_DOT)).toBe(true);
  expect(isFaintYellow(...HIGHLIGHTER)).toBe(false);
  expect(isFaintYellow(...PAPER)).toBe(false);
  expect(isFaintYellow(...TEXT)).toBe(false);
  expect(isFaintYellow(230, 240, 255)).toBe(false); // 淡藍
  expect(isFaintYellow(255, 200, 200)).toBe(false); // 淡紅
});

test("去掉淡黃色：只有追蹤點變白，其他顏色不動", () => {
  const data = pixels(DOT, SCANNED_DOT, HIGHLIGHTER, TEXT, PAPER);
  expect(removeYellow(data)).toBe(2);
  expect(at(data, 0)).toEqual([255, 255, 255]);
  expect(at(data, 1)).toEqual([255, 255, 255]);
  expect(at(data, 2)).toEqual(HIGHLIGHTER);
  expect(at(data, 3)).toEqual(TEXT);
  expect(at(data, 4)).toEqual(PAPER);
});

test("只看黃色：黑字與白紙變成白色，黃色越飽和越暗，回傳淡黃色像素的個數", () => {
  const data = pixels(DOT, TEXT, PAPER, HIGHLIGHTER);
  expect(revealYellow(data)).toBe(1);
  expect(at(data, 1)).toEqual([255, 255, 255]);
  expect(at(data, 2)).toEqual([255, 255, 255]);
  expect(data[0]!).toBeLessThan(255);
  expect(data[12]!).toBe(0);
});

test("轉成黑白：字變黑，紙與追蹤點變白，門檻限制在 100 到 200", () => {
  const page = [...Array(90).fill(PAPER), ...Array(8).fill(TEXT), DOT, SCANNED_DOT] as [number, number, number][];
  const data = pixels(...page);
  const threshold = toBlackWhite(data);
  expect(threshold).toBeGreaterThanOrEqual(100);
  expect(threshold).toBeLessThanOrEqual(200);
  expect(at(data, 0)).toEqual([255, 255, 255]);
  expect(at(data, 90)).toEqual([0, 0, 0]);
  expect(at(data, 98)).toEqual([255, 255, 255]);
  expect(at(data, 99)).toEqual([255, 255, 255]);
  // 整頁都是白紙：門檻停在預設值，紙照樣是白的
  const blank = pixels(...Array(10).fill(PAPER));
  expect(otsuThreshold(blank)).toBe(160);
  toBlackWhite(blank);
  expect(at(blank, 0)).toEqual([255, 255, 255]);
});

test("淡黃色占了一大片時當成光線偏黃，不說成追蹤點", () => {
  expect(judge(0, 1000)).toBe("none");
  expect(judge(40, 1000)).toBe("found");
  expect(judge(600, 1000)).toBe("tinted");
});

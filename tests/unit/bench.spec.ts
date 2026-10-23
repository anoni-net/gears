import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { OCR_SAMPLES, cer, median } from "../../src/tools/bench/ocr.ts";

test("字錯率：編輯距離除以正確答案的字數，不算空白", () => {
  expect(cer("個資辨識", "個資辨識")).toBe(0);
  expect(cer("個資辨識", "個資辯識")).toBe(0.25);
  expect(cer("個資辨識", "個資")).toBe(0.5);
  expect(cer("個資", "個資辨識")).toBe(1);
  expect(cer("Q3 complaints", "Q3complaints")).toBe(0);
  expect(cer("", "")).toBe(0);
  expect(cer("", "多")).toBe(1);
});

test("中位數", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(median([])).toBeNaN();
});

test("文字辨識的範例截圖：檔案的 SHA-256 與尺寸跟 ocr-samples.json 一致，每張都有正確答案", () => {
  expect(OCR_SAMPLES.map((s) => s.id)).toEqual(["phone", "desktop", "lowres"]);
  for (const sample of OCR_SAMPLES) {
    const bytes = readFileSync(`public/${sample.file}`);
    expect(createHash("sha256").update(bytes).digest("hex"), sample.id).toBe(sample.sha256);
    // PNG 的 IHDR：寬與高在第 16 與 20 個位元組
    expect(bytes.readUInt32BE(16), sample.id).toBe(sample.width);
    expect(bytes.readUInt32BE(20), sample.id).toBe(sample.height);
    expect(sample.lines.join("").length, sample.id).toBeGreaterThan(40);
  }
});

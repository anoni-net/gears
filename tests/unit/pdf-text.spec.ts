import { expect, test } from "@playwright/test";
import { type ImageOps, type TextRun, findPiiInLines, imageRegions, lineBoxes, textLayerQuality, textLines } from "../../src/tools/redact/pdf-text.ts";

// pdf.js 的 viewport 把 PDF 的座標（原點在左下）換成畫布的座標（原點在左上）：
// 縮放 2 倍、頁高 400 點，換算之後的 transform 是 [2s, 0, 0, -2s, 2x, 800 - 2y]
const SCALE = 2;
const PAGE = 400;
const run = (str: string, x: number, y: number, size: number, width: number, extra: Partial<TextRun> = {}): TextRun => ({
  str,
  transform: [SCALE * size, 0, 0, -SCALE * size, SCALE * x, SCALE * (PAGE - y)],
  length: SCALE * width,
  ascent: 0.8,
  vertical: false,
  eol: false,
  ...extra,
});
const W = SCALE * PAGE;

test("同一條基線的段落接成一行，換行與換基線時分開", () => {
  const lines = textLines([
    run("電話", 50, 300, 10, 20),
    run("0912345678", 70, 300, 10, 55, { eol: true }),
    run("Email", 50, 280, 10, 27),
    // 離上一段 3 個字高，補一個空白
    run("jane@example.org", 107, 280, 10, 90),
    // 基線不同，另起一行
    run("第二頁", 50, 100, 10, 30),
  ]);
  expect(lines.map((l) => l.text)).toEqual(["電話0912345678", "Email jane@example.org", "第二頁"]);
  expect(lines[1]!.boxes[5]).toBeNull();
  expect(lines.every((l) => l.boxes.length === l.text.length)).toBe(true);
});

test("一段文字裡的個資：依字寬分配位置，框起來的範圍蓋住那幾個字", () => {
  // 兩個全形字加 10 個數字：寬度的比例是 2 比 5.5
  const lines = textLines([run("電話0912345678", 50, 300, 10, 75)]);
  const [match] = findPiiInLines(lines, W, W);
  expect(match!.kind).toBe("phone");
  expect(match!.text).toBe("0912345678");
  const height = SCALE * 10;
  const start = SCALE * 50 + ((SCALE * 75) / 7.5) * 2;
  // 左右各多留四分之一個字高，上下是一個字高，基線以上占 0.8
  expect(match!.box.x).toBeCloseTo(start - height / 4);
  expect(match!.box.x + match!.box.w).toBeCloseTo(SCALE * 125 + height / 4);
  expect(match!.box.y).toBeCloseTo(SCALE * (PAGE - 300) - 0.8 * height);
  expect(match!.box.h).toBeCloseTo(height);
});

test("電話拆成兩段時合成一個框，中間有空隙時補空白也比對得到", () => {
  const joined = textLines([run("0912", 50, 300, 10, 22), run("345678", 72, 300, 10, 33)]);
  expect(joined[0]!.text).toBe("0912345678");
  expect(findPiiInLines(joined, W, W).map((m) => m.text)).toEqual(["0912345678"]);
  const spaced = textLines([run("0912", 50, 300, 10, 22), run("345678", 80, 300, 10, 33)]);
  expect(spaced[0]!.text).toBe("0912 345678");
  const [match] = findPiiInLines(spaced, W, W);
  expect(match!.text).toBe("0912 345678");
  // 框從第一段的開頭到第二段的結尾
  expect(match!.box.x).toBeCloseTo(SCALE * 50 - 5);
  expect(match!.box.x + match!.box.w).toBeCloseTo(SCALE * 113 + 5);
});

test("直書的段落往下展開", () => {
  const lines = textLines([run("電話0912345678", 50, 300, 10, 75, { vertical: true })]);
  const [box] = lineBoxes(lines, W, W);
  // 轉 90 度之後，書寫方向朝下，寬度是一個字高，以原點為中心
  expect(box!.w).toBeCloseTo(SCALE * 10);
  expect(box!.x).toBeCloseTo(SCALE * 50 - SCALE * 5);
  expect(box!.y).toBeCloseTo(SCALE * (PAGE - 300) - 5);
  expect(box!.h).toBeCloseTo(SCALE * 75 + 10);
});

test("轉了 90 度的頁面，段落的外框照轉過的方向算", () => {
  // 逆時針轉 90 度：書寫方向朝上
  const rotated: TextRun = { ...run("0912345678", 0, 0, 10, 55), transform: [0, -20, -20, 0, 100, 700] };
  const [box] = lineBoxes(textLines([rotated]), W, W);
  expect(box!.w).toBeCloseTo(20);
  expect(box!.y + box!.h).toBeCloseTo(705);
  expect(box!.h).toBeCloseTo(110 + 10);
});

test("框起所有文字：只有符號的行不框，頁面外的部分裁掉", () => {
  const lines = textLines([run("—— · ——", 50, 300, 10, 40, { eol: true }), run("超出頁面的字", 380, 200, 10, 60)]);
  const boxes = lineBoxes(lines, W, W);
  expect(boxes).toHaveLength(1);
  expect(boxes[0]!.x + boxes[0]!.w).toBe(W);
});

test("文字層能不能用：沒有字、亂碼、正常", () => {
  expect(textLayerQuality([])).toBe("none");
  expect(textLayerQuality([run("  ", 0, 0, 10, 5), run("·", 0, 0, 10, 5)])).toBe("none");
  expect(textLayerQuality([run("ab", 0, 0, 10, 30)])).toBe("garbled");
  expect(textLayerQuality([run("報價單 � 第 1 頁", 0, 0, 10, 30)])).toBe("ok");
});

// pdf.js 的 OPS 裡用到的幾個，數值跟 pdfjs-dist 相同
const OPS: ImageOps = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageMaskXObject: 83,
  paintImageMaskXObjectGroup: 84,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintInlineImageXObjectGroup: 87,
  paintImageXObjectRepeat: 88,
  paintImageMaskXObjectRepeat: 89,
};
const VIEWPORT = [SCALE, 0, 0, -SCALE, 0, W];

test("頁面上的圖片：追蹤座標變換，算出畫在畫布上的範圍", () => {
  const regions = imageRegions(
    [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintFormXObjectBegin, OPS.transform, OPS.paintImageXObject, OPS.paintFormXObjectEnd, OPS.paintImageXObject],
    [[], [100, 0, 0, 50, 10, 20], ["img1"], [], [[1, 0, 0, 1, 200, 200], null], [40, 0, 0, 40, 0, 0], ["img2"], [], ["tiny"]],
    OPS,
    VIEWPORT,
    W,
    W,
  );
  // 第一張：(10,20) 起 100×50 點，第二張在表單的 (200,200) 起 40×40 點，最後一張只有 1 點，太小不算
  expect(regions).toEqual([
    { x: 20, y: 660, w: 200, h: 100 },
    { x: 400, y: 320, w: 80, h: 80 },
  ]);
});

test("蓋住大半頁的圖片、算不出位置的畫法，整頁辨識", () => {
  expect(imageRegions([OPS.transform, OPS.paintImageXObject], [[400, 0, 0, 300, 0, 0], ["scan"]], OPS, VIEWPORT, W, W)).toBe("page");
  expect(imageRegions([OPS.paintInlineImageXObjectGroup], [[{}, []]], OPS, VIEWPORT, W, W)).toBe("page");
});

test("重疊的圖片合成一塊，重複畫的圖片逐一算", () => {
  const regions = imageRegions(
    [OPS.transform, OPS.paintImageXObject, OPS.paintImageXObject, OPS.paintImageXObjectRepeat],
    [[50, 0, 0, 50, 10, 10], ["a"], ["b"], ["c", 0.5, 0.5, [100, 100, 0.2, 0.2]]],
    OPS,
    VIEWPORT,
    W,
    W,
  );
  expect(regions).toEqual([{ x: 20, y: 680, w: 100, h: 100 }]);
});

test("全形的電話也比對得到，回傳原文", () => {
  const [match] = findPiiInLines(textLines([run("電話：０９１２－３４５－６７８", 50, 300, 10, 150)]), W, W);
  expect(match!.kind).toBe("phone");
  expect(match!.text).toBe("０９１２－３４５－６７８");
});

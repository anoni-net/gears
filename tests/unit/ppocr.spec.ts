import { expect, test } from "@playwright/test";
import dict from "../../src/tools/redact/ppocr-dict.json" with { type: "json" };
import { type OcrLine, cropFrame, cropTransform, ctcDecode, dbBoxes, detSize, keepLine, recWidth, words } from "../../src/tools/redact/ppocr.ts";

// 在機率圖上畫一個旋轉的長方形，中心 (cx, cy)、長寬 w × h、轉 deg 度
function probMap(W: number, H: number, shapes: { cx: number; cy: number; w: number; h: number; deg: number; p: number }[]) {
  const prob = new Float32Array(W * H);
  for (const s of shapes) {
    const a = (s.deg * Math.PI) / 180;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - s.cx;
        const dy = y + 0.5 - s.cy;
        const u = dx * Math.cos(a) + dy * Math.sin(a);
        const v = -dx * Math.sin(a) + dy * Math.cos(a);
        if (Math.abs(u) <= s.w / 2 && Math.abs(v) <= s.h / 2) prob[y * W + x] = s.p;
      }
  }
  return prob;
}

test("偵測的輸入尺寸：長邊最多 2560、短邊至少 64，取 32 的倍數", () => {
  expect(detSize(1170, 2532)).toEqual({ w: 1184, h: 2528 });
  expect(detSize(4032, 3024)).toEqual({ w: 2560, h: 1920 });
  expect(detSize(40, 20)).toEqual({ w: 128, h: 64 });
});

test("轉歪的文字行用旋轉矩形算分數，不會因為外接矩形裡大半是背景被丟掉", () => {
  // 120 × 16 轉 10 度：外接矩形約 121 × 37，裡面只有四成是文字，水平的外接矩形算出來的平均機率不到 0.6
  const prob = probMap(200, 100, [{ cx: 100, cy: 50, w: 120, h: 16, deg: 10, p: 0.9 }]);
  let sum = 0;
  let n = 0;
  for (let y = 28; y < 72; y++) for (let x = 39; x < 161; x++, n++) sum += prob[y * 200 + x]!;
  expect(sum / n).toBeLessThan(0.6);
  const [found, ...rest] = dbBoxes(prob, 200, 100, 2, 2);
  expect(rest).toEqual([]);
  expect(found!.score).toBeGreaterThan(0.8);
  const [tl, tr] = found!.quad;
  // 沿著文字的方向，換回原圖座標（放大 2 倍）
  expect((Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI).toBeCloseTo(10, 0);
  const frame = cropFrame(found!.quad);
  // unclip 往外擴張 面積 × 1.5 ÷ 周長，長寬各加 2d。凸包取像素的角，比畫上去的長方形多一圈，差幾個像素
  const d = (120 * 16 * 1.5) / (2 * (120 + 16));
  expect(Math.abs(frame.w / 2 - (120 + 2 * d))).toBeLessThan(4);
  expect(Math.abs(frame.h / 2 - (16 + 2 * d))).toBeLessThan(4);
});

test("機率低的區塊與太小的區塊不算文字行", () => {
  const prob = probMap(200, 100, [
    { cx: 50, cy: 30, w: 60, h: 12, deg: 0, p: 0.4 },
    { cx: 150, cy: 70, w: 2, h: 2, deg: 0, p: 0.95 },
  ]);
  expect(dbBoxes(prob, 200, 100, 1, 1)).toEqual([]);
});

test("由上而下、由左而右排列", () => {
  const prob = probMap(300, 100, [
    { cx: 220, cy: 20, w: 100, h: 12, deg: 0, p: 0.9 },
    { cx: 60, cy: 22, w: 100, h: 12, deg: 0, p: 0.9 },
    { cx: 60, cy: 70, w: 100, h: 12, deg: 0, p: 0.9 },
  ]);
  const centers = dbBoxes(prob, 300, 100, 1, 1).map((b) => [Math.round(b.box.x + b.box.w / 2), Math.round(b.box.y + b.box.h / 2)]);
  expect(centers.map(([x]) => x)).toEqual([60, 220, 60]);
});

test("裁切：高大於寬 1.5 倍的直書轉 90 度，仿射轉換把三個角對到畫布的角", () => {
  const vertical = cropFrame([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 100 },
    { x: 0, y: 100 },
  ]);
  expect([vertical.w, vertical.h]).toEqual([100, 20]);
  expect(vertical.tl).toEqual({ x: 20, y: 0 });

  const frame = { tl: { x: 10, y: 20 }, tr: { x: 110, y: 40 }, bl: { x: 6, y: 40 } };
  const [a, b, c, d, e, f] = cropTransform(frame, 300, 48);
  const apply = (p: { x: number; y: number }) => [a! * p.x + c! * p.y + e!, b! * p.x + d! * p.y + f!];
  for (const [p, want] of [
    [frame.tl, [0, 0]],
    [frame.tr, [300, 0]],
    [frame.bl, [0, 48]],
  ] as const) {
    const [x, y] = apply(p);
    expect(x).toBeCloseTo(want[0]);
    expect(y).toBeCloseTo(want[1]);
  }
});

test("辨識的輸入：高 48，寬度照比例無條件進位，補到至少 320", () => {
  expect(recWidth(100, 20)).toEqual({ width: 240, padded: 320 });
  expect(recWidth(401, 20)).toEqual({ width: 963, padded: 963 });
});

test("CTC 解碼：連續相同的合併、空白分開，每個字沿著這一行換回原圖", () => {
  // 字典 3 個字，輸出 5 類：0 是空白、1 到 3 是字典、4 是空格
  const C = 5;
  const steps = [1, 1, 0, 2, 0, 4, 3, 3];
  const data = new Float32Array(steps.length * C);
  steps.forEach((c, t) => (data[t * C + c] = 1));
  // 沒有補寬（width 等於 padded），一行從 (100, 50) 往右 80 像素、高 10
  const frame = { tl: { x: 100, y: 50 }, tr: { x: 180, y: 50 }, bl: { x: 100, y: 60 } };
  const r = ctcDecode(data, steps.length, C, ["甲", "乙", "丙"], frame, 384, 384);
  expect(r.text).toBe("甲乙 丙");
  expect(r.chars.map((c) => c.c)).toEqual(["甲", "乙", "丙"]);
  // 每個時間步 10 像素：甲在 0 到 2、乙在 3、丙在 6 到 8，每個字的框至少蓋住自己的時間步
  expect(r.chars[0]!.box.x).toBeCloseTo(100);
  expect(r.chars[1]!.box.x).toBeLessThanOrEqual(130);
  expect(r.chars[1]!.box.x + r.chars[1]!.box.w).toBeGreaterThanOrEqual(140);
  expect(r.chars[2]!.box.x + r.chars[2]!.box.w).toBeCloseTo(180);
  expect(r.chars.every((c) => c.box.y === 50 && c.box.h === 10)).toBe(true);
  expect(r.chars[0]!.box.x + r.chars[0]!.box.w).toBeLessThanOrEqual(r.chars[1]!.box.x + 1e-9);
});

test("交給 findPii 的字：漢字一個一個，英數連成一個，空白斷開", () => {
  const box = (x: number) => ({ x, y: 0, w: 10, h: 20 });
  const text = "電話 0912-345-678";
  const chars = [...text.replace(/ /g, "")].map((c, i) => ({ c, prob: 1, box: box(i * 10) }));
  const line: OcrLine = { text, score: 1, detScore: 1, box: { x: 0, y: 0, w: 140, h: 20 }, quad: [{ x: 0, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 20 }, { x: 0, y: 20 }], chars };
  const ws = words(line);
  expect(ws.map((w) => w.text)).toEqual(["電", "話", "0912-345-678"]);
  expect(ws[2]!.box).toEqual({ x: 20, y: 0, w: 120, h: 20 });
});

test("框起所有文字：一個字而且分數低的不框", () => {
  expect(keepLine({ text: "O", score: 0.3 })).toBe(false);
  expect(keepLine({ text: "王", score: 0.9 })).toBe(true);
  expect(keepLine({ text: "彭化联员林市", score: 0.4 })).toBe(true);
});

test("字典取自辨識模型，正體與簡體的字都有", () => {
  expect(dict).toHaveLength(18383);
  for (const c of ["臺", "台", "灣", "湾", "豪", "綠"]) expect(dict).toContain(c);
});

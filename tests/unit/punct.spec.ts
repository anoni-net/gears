import { expect, test } from "@playwright/test";
import { LANGUAGES } from "../../src/tools/transcribe/languages.ts";
import { modelsFor } from "../../src/tools/transcribe/languages.ts";
import {
  type Prediction,
  PUNCT_MB,
  PUNCT_MODEL,
  applyInserts,
  cleanForModel,
  joinSegments,
  labelMark,
  lowerKeepLen,
  placeMarks,
  punctAvailable,
  splitForDisplay,
  tokenEnds,
  windows,
} from "../../src/tools/transcribe/punct.ts";

// 逐字稿的標點建議（src/tools/transcribe/punct.ts）。真的模型只在本機的瀏覽器測試執行（GEARS_PUNCT_MODEL=1）

// 從套用之後的文字拿掉插入的標點（依位置，不依字元），剩下的要跟原文一模一樣
function strip(applied: string, inserts: Parameters<typeof applyInserts>[1]): string {
  let out = applied;
  const sorted = [...inserts].sort((x, y) => x.at - y.at);
  for (let j = sorted.length - 1; j >= 0; j--) {
    const pos = sorted[j]!.at + j;
    expect(out[pos]).toBe(sorted[j]!.mark);
    out = out.slice(0, pos) + out.slice(pos + 1);
  }
  return out;
}

test("下載量用經過 Cloudflare 的實際傳輸量，檔案清單有 SHA-256", () => {
  expect(PUNCT_MB).toBe(148);
  expect(Object.keys(PUNCT_MODEL.files)).toContain("onnx/model_quantized.onnx");
  for (const sha of Object.values(PUNCT_MODEL.files)) expect(sha).toMatch(/^[0-9a-f]{64}$/);
  expect(PUNCT_MODEL.bytes).toBe(176351361);
});

test("轉小寫：逐個字轉，長度改變的字維持原樣", () => {
  expect(lowerKeepLen("ABC 中文 Work")).toBe("abc 中文 work");
  // İ 轉小寫會變成兩個字元（i 加上一點），維持原樣
  expect(lowerKeepLen("İstanbul")).toBe("İstanbul");
  // 整串 toLowerCase 會把字尾的 Σ 換成 ς，逐個字轉都是 σ，跟評測的 Python 相同
  expect(lowerKeepLen("ΣΑΣ")).toBe("σασ");
  // 代理對（4 個位元組的字）照樣處理，長度不變
  const deseret = "\u{10400}x";
  expect(lowerKeepLen(deseret)).toBe("\u{10428}x");
  for (const s of ["İstanbul ΣΑΣ", "𠮷野家 OK", "ǅ"]) expect(lowerKeepLen(s).length).toBe(s.length);
});

test("詞元結尾換成 UTF-16 位置：開頭補上的空白扣掉", () => {
  expect(tokenEnds(["▁我", "們", "▁ok"], "我們 ok")).toEqual([1, 2, 5]);
  // 數字被拆成一個一個的詞元
  expect(tokenEnds(["▁work", "▁", "2", "0"], "work 20")).toEqual([4, 5, 6, 7]);
});

test("詞元結尾換成 UTF-16 位置：代理對占兩個單位", () => {
  expect(tokenEnds(["▁", "𠮷", "野"], "𠮷野")).toEqual([0, 2, 3]);
  expect(tokenEnds(["▁a", "😀", "b"], "a😀b")).toEqual([1, 3, 4]);
});

test("詞元結尾換成 UTF-16 位置：位元組備援拆開的字算到那個字的結尾", () => {
  // ǅ 是 U+01C5，UTF-8 兩個位元組
  expect(tokenEnds(["▁", "<0xC7>", "<0x85>", "a"], "ǅa")).toEqual([0, 1, 1, 2]);
  // 4 個位元組的表情符號拆成 4 個位元組備援
  expect(tokenEnds(["▁a", "<0xF0>", "<0x9F>", "<0x98>", "<0x80>"], "a😀")).toEqual([1, 3, 3, 3, 3]);
});

test("詞元還原不回原文時不給位置", () => {
  // 文字以空白開頭時 Metaspace 不會再補空白，位置會全部偏一格
  expect(tokenEnds(["▁leading"], " leading")).toBeNull();
  // <mask> 這類特殊詞元會吃掉前面的空白
  expect(tokenEnds(["▁a", "<mask>"], "a <mask>")).toBeNull();
  // 位元組備援拼不成完整的字
  expect(tokenEnds(["▁", "<0xC7>"], "ǅ")).toBeNull();
});

test("標籤只取標點，冒號、破折號與大小寫不用", () => {
  expect(labelMark("0|lower")).toBeNull();
  expect(labelMark(".|UPPER")).toBe(".");
  expect(labelMark(",|Cap")).toBe(",");
  expect(labelMark("?|lower")).toBe("?");
  expect(labelMark("-|lower")).toBeNull();
  expect(labelMark(":|Cap")).toBeNull();
  expect(labelMark("")).toBeNull();
});

test("每 400 個詞元一段、重疊 50 個，每個詞元剛好由一段負責", () => {
  expect(windows(0)).toEqual([]);
  expect(windows(400)).toEqual([{ start: 0, end: 400, keepTo: 400 }]);
  expect(windows(401)).toEqual([
    { start: 0, end: 400, keepTo: 350 },
    { start: 350, end: 401, keepTo: 401 },
  ]);
  for (const n of [1, 399, 750, 1234, 9000]) {
    const owned = new Array(n).fill(0);
    for (const w of windows(n)) {
      expect(w.end - w.start).toBeLessThanOrEqual(400);
      for (let k = w.start; k < w.keepTo; k++) owned[k]++;
    }
    expect(owned.every((x) => x === 1)).toBe(true);
  }
});

test("段落接起來：中文之間不加空白，兩邊都是英數才加", () => {
  expect(joinSegments(["今天", "天氣"])).toEqual({ text: "今天天氣", starts: [0, 2] });
  expect(joinSegments(["hello", "world"])).toEqual({ text: "hello world", starts: [0, 6] });
  expect(joinSegments(["用 iPhone", "錄的"])).toEqual({ text: "用 iPhone錄的", starts: [0, 8] });
  expect(joinSegments(["work", "2002"])).toEqual({ text: "work 2002", starts: [0, 5] });
});

test("交給模型的文字：拿掉原本的標點，數字與詞裡面的照留，轉小寫，位置對得回原文", () => {
  const text = " 你好，世界!  3.5 公尺 Don't「引號」1,000 ";
  const { clean, origin } = cleanForModel(text);
  expect(clean).toBe("你好世界 3.5 公尺 don't引號1,000");
  expect(origin.length).toBe(clean.length);
  for (let k = 0; k < clean.length; k++) {
    if (clean[k] === " ") expect(text[origin[k]!]).toMatch(/\s/);
    else expect(lowerKeepLen(text[origin[k]!]!)).toBe(clean[k]);
  }
});

const SEGMENTS = ["今天天氣很好我們去公園", "你要一起來嗎", "好啊"];
// 接起來是「今天天氣很好我們去公園你要一起來嗎好啊」
const at = (s: string, after: string) => s.indexOf(after) + after.length;

test("標點分回各段，落在段落結尾的屬於那一段，華語用全形", () => {
  const clean = cleanForModel(joinSegments(SEGMENTS).text).clean;
  const predictions: Prediction[] = [
    [at(clean, "很好"), ","],
    [at(clean, "公園"), "."],
    [at(clean, "來嗎"), "?"],
    [at(clean, "好啊"), "."],
  ];
  const inserts = placeMarks(SEGMENTS, predictions);
  expect(inserts).toEqual([
    [
      { at: 6, mark: "，" },
      { at: 11, mark: "。" },
    ],
    [{ at: 6, mark: "？" }],
    [{ at: 2, mark: "。" }],
  ]);
  expect(SEGMENTS.map((t, i) => applyInserts(t, inserts[i]!))).toEqual(["今天天氣很好，我們去公園。", "你要一起來嗎？", "好啊。"]);
  // 畫面上依序顯示原文與建議的標點
  expect(splitForDisplay(SEGMENTS[0]!, inserts[0]!)).toEqual([
    { text: "今天天氣很好", suggested: false },
    { text: "，", suggested: true },
    { text: "我們去公園", suggested: false },
    { text: "。", suggested: true },
  ]);
});

test("只插入標點，拿掉插入的標點之後跟原文相同", () => {
  const segments = ["我用 iPhone 15 錄的", "𠮷野家很好吃😀還有", "6.5 公尺，Don't worry", "ǅ İstanbul 好"];
  const clean = cleanForModel(joinSegments(segments).text).clean;
  // 每個位置都標上標點，最極端的情況
  const predictions: Prediction[] = [];
  for (let k = 1; k <= clean.length; k++) predictions.push([k, ([".", ",", "?"] as const)[k % 3]!]);
  const inserts = placeMarks(segments, predictions);
  segments.forEach((t, i) => {
    expect(strip(applyInserts(t, inserts[i]!), inserts[i]!)).toBe(t);
    // 插入的標點都是全形，位置在段落的範圍裡
    for (const ins of inserts[i]!) {
      expect(["，", "。", "？"]).toContain(ins.mark);
      expect(ins.at).toBeGreaterThan(0);
      expect(ins.at).toBeLessThanOrEqual(t.length);
    }
  });
  const applied = segments.map((t, i) => applyInserts(t, inserts[i]!));
  // 詞的中間、數字中間、代理對中間都不插
  expect(applied[0]).toContain("iPhone");
  expect(applied[0]).toContain("15");
  expect(applied[1]).toContain("𠮷");
  expect(applied[2]).toContain("6.5");
  expect(applied[2]).toContain("Don't");
  expect(applied[3]).toContain("İstanbul");
  // 跟逐字稿裡原本的標點相鄰的位置不插
  expect(applied[2]).not.toMatch(/[，。？]，|，[，。？]/);
});

test("Whisper 已經有的標點保留，前後已經是標點的位置不重複插入", () => {
  const segments = ["你要一起來嗎?", "好，我們走吧"];
  const clean = cleanForModel(joinSegments(segments).text).clean;
  expect(clean).toBe("你要一起來嗎好我們走吧");
  const inserts = placeMarks(segments, [
    [at(clean, "來嗎"), "?"], // 後面已經有半形的問號
    [at(clean, "來嗎好"), ","], // 前面是「好」，後面已經有逗號
    [at(clean, "走吧"), "."],
  ]);
  expect(inserts).toEqual([[], [{ at: 6, mark: "。" }]]);
});

test("落在空白或英文段落的分界時，標點接在前一個字後面", () => {
  const segments = ["hello", "world"];
  const clean = cleanForModel(joinSegments(segments).text).clean;
  expect(clean).toBe("hello world");
  // 詞元「▁」的結尾在空白上，退回 hello 的結尾，跟 hello 的預測是同一個位置，只算一次
  const inserts = placeMarks(segments, [
    [5, ","],
    [6, "."],
    [11, "."],
  ]);
  expect(inserts).toEqual([[{ at: 5, mark: "，" }], [{ at: 5, mark: "。" }]]);
});

test("超出範圍的位置略過", () => {
  expect(placeMarks(["好"], [[0, "."], [5, "."], [-1, ","]])).toEqual([[]]);
  expect(placeMarks([], [[1, "."]])).toEqual([]);
});

test("只在華語、Whisper（base、small、large-v3-turbo）與 Breeze-ASR-25 的路上提供", () => {
  const offered: string[] = [];
  for (const language of LANGUAGES) for (const model of modelsFor(language)) if (punctAvailable(language, model)) offered.push(`${language}:${model}`);
  expect(offered.sort()).toEqual(["zh:base", "zh:breeze25", "zh:small", "zh:turbo"]);
  // 台語、粵語、Omnilingual 這次不提供
  expect(punctAvailable("nan", "breeze26")).toBe(false);
  expect(punctAvailable("yue", "turbo")).toBe(false);
  expect(punctAvailable("bn", "omni")).toBe(false);
  expect(punctAvailable("en", "small")).toBe(false);
});

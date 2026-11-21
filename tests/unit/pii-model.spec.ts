import { expect, test } from "@playwright/test";
import { PII_SAMPLES, foundCount } from "../../src/tools/bench/pii.ts";
import type { LineText } from "../../src/tools/redact/pii.ts";
import { PII_MB, PII_MODEL, align, chunkLines, groupSpans, joinLines, labelKind, spanBoxes } from "../../src/tools/redact/pii-model.ts";

// 假的 tokenizer：一個 id 對一段文字，0 與 1 是特殊詞元，2 是 [UNK]
function fake(pieces: string[]) {
  const vocab = ["<s>", "</s>", "<unk>", ...pieces];
  return {
    all_special_ids: [0, 1, 2],
    unk_token_id: 2,
    decode: (ids: number[]) => ids.map((id) => (id <= 2 ? "" : vocab[id]!)).join(""),
    ids: (...words: string[]) => words.map((w) => (w === "<unk>" ? 2 : vocab.indexOf(w))),
  };
}

test("詞元對回原文：跳過特殊詞元與空白，全形冒號照 NFKC 對得上，[UNK] 取前後的空隙", () => {
  const tok = fake(["林", "志明", ":", "0912", "-345"]);
  const text = "林 志明：0912-345";
  const ids = [0, ...tok.ids("林", "志明", ":", "0912", "-345"), 1];
  expect(align(tok, text, ids)).toEqual([null, [0, 1], [2, 4], [4, 5], [5, 9], [9, 13], null]);
  // 中間一個詞元認不得（[UNK]），用前後兩個詞元之間的範圍
  expect(align(tok, "林志明", tok.ids("林", "<unk>"))).toEqual([[0, 1], [1, 3]]);
});

test("相鄰、同一類的詞元合成一個範圍，類別不同或中間隔著別的字就分開", () => {
  const text = "松仁路 100 號找林志明";
  const spans = groupSpans(text, [
    { kind: "address", start: 0, end: 3 },
    { kind: "address", start: 4, end: 7 },
    { kind: "address", start: 8, end: 9 },
    { kind: "person", start: 10, end: 11 },
    { kind: "person", start: 11, end: 13 },
  ]);
  expect(spans).toEqual([
    { kind: "address", start: 0, end: 9 },
    { kind: "person", start: 10, end: 13 },
  ]);
});

test("找到幾個：一半以上的字被蓋住才算，標籤對應到幾類，日期這類不算", () => {
  const sample = PII_SAMPLES[0];
  const at = (word: string) => sample.text.indexOf(word);
  const spans = [
    { kind: "person" as const, start: at("林志明"), end: at("林志明") + 2 },
    { kind: "phone" as const, start: at("0912-345-678"), end: at("0912-345-678") + 4 },
  ];
  // 林志明蓋住 2/3 算找到，電話只蓋住 4/12 不算
  expect(foundCount(sample.text, sample.expect, spans)).toBe(1);
  expect(labelKind("B-GIVEN_NAME")).toBe("person");
  expect(labelKind("I-COMPANY_NAME")).toBe("org");
  expect(labelKind("O")).toBeNull();
  expect(labelKind("B-DATE")).toBeNull();
  // 範例文字裡每一個應該找到的字都真的出現在文字裡
  for (const s of PII_SAMPLES) for (const word of s.expect) expect(s.text, word).toContain(word);
});

// 一行文字，每個字一個寬 10 的框，y 是行的位置。空白是補上的（null）
function line(text: string, y: number): LineText {
  return { text, boxes: [...text].map((c, i) => (c === " " ? null : { x: i * 10, y, w: 10, h: 10 })) };
}

test("文字行接成一段：行與行之間放換行，記下每個位置來自哪一行的第幾個字", () => {
  const { text, at } = joinLines([line("林志明", 0), line("0912", 20)]);
  expect(text).toBe("林志明\n0912");
  expect(at).toEqual([[0, 0], [0, 1], [0, 2], null, [1, 0], [1, 1], [1, 2], [1, 3]]);
});

test("模型的範圍換回字框：同一行合成一個框，跨行的每一行各給一個框", () => {
  const lines = [line("聯絡人 陳怡", 0), line("君 電話", 20)];
  const { text, at } = joinLines(lines);
  const start = text.indexOf("陳");
  // 「陳怡\n君」被換行拆開，模型的範圍跨過換行
  const found = spanBoxes(lines, at, [{ kind: "person", start, end: start + 4 }]);
  expect(found).toEqual([
    { kind: "person", text: "陳怡", box: { x: 40, y: 0, w: 20, h: 10 } },
    { kind: "person", text: "君", box: { x: 0, y: 20, w: 10, h: 10 } },
  ]);
});

test("補上的空白只在兩邊都是英數時留著，中文字之間不留（照研究的 pipeline.mjs）", () => {
  const { text, at } = joinLines([line("電話 0912 345", 0), line("Kevin Lin 先生", 20)]);
  expect(text).toBe("電話0912 345\nKevin Lin先生");
  // 留下的空白沒有字框
  expect(at[text.indexOf(" ")]).toBeNull();
  expect(at[text.indexOf("0")]).toEqual([0, 3]);
});

test("模型的範圍只有空白或換行時不給框", () => {
  const lines = [line("ab cd", 0), line("ef", 20)];
  const { text, at } = joinLines(lines);
  expect(text).toBe("ab cd\nef");
  expect(spanBoxes(lines, at, [{ kind: "org", start: 2, end: 3 }])).toEqual([]);
  expect(spanBoxes(lines, at, [{ kind: "org", start: 5, end: 6 }])).toEqual([]);
});

test("依行分塊：每塊不超過上限，不在一行的中間切開，一行就超過上限時自成一塊", () => {
  const lines = [line("一二三四", 0), line("五六七", 20), line("八九十甲乙丙丁戊", 40), line("己", 60)];
  expect(chunkLines(lines, 9).map((c) => c.map((l) => l.text))).toEqual([["一二三四", "五六七"], ["八九十甲乙丙丁戊"], ["己"]]);
  expect(chunkLines([], 9)).toEqual([]);
});

test("模型檔放在 assets.anoni.net，每個檔案都有 SHA-256，畫面上寫的下載量是實際的傳輸量", () => {
  expect(PII_MB).toBe(200);
  expect(PII_MODEL.dir).toBe(`nym-pii-${PII_MODEL.revision.slice(0, 7)}`);
  for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json", `onnx/model_${PII_MODEL.dtype}.onnx`, `onnx/model_${PII_MODEL.dtype}.onnx_data`])
    expect(PII_MODEL.files[file], file).toMatch(/^[0-9a-f]{64}$/);
});

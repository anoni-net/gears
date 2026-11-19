import { expect, test } from "@playwright/test";
import { PII_SAMPLES, align, foundCount, groupSpans, labelKind } from "../../src/tools/bench/pii.ts";

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

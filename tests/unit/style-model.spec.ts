import { expect, test } from "@playwright/test";
import { chunkText } from "../../src/tools/redact/pii-model.ts";
import { modelTerms } from "../../src/tools/writing-style/index.ts";

// 寫作習慣檢查的「找人名、地址與單位」（#143）：貼上的文字分塊交給個資辨識模型，找到的範圍換成清單

test("分塊：依行接起來，每塊不超過上限，位置對得回原文", () => {
  const text = "第一行\n第二行\n\n第三行";
  expect(chunkText(text, 100)).toEqual([{ text, offset: 0 }]);
  const chunks = chunkText(text, 8);
  for (const c of chunks) {
    expect(c.text.length).toBeLessThanOrEqual(8);
    expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  }
  expect(chunks.map((c) => c.text).join("")).toBe(text);
});

test("分塊：比上限長的一行在句尾切開，沒有句尾時硬切", () => {
  const long = `${"甲".repeat(30)}。${"乙".repeat(30)}。${"丙".repeat(30)}`;
  const chunks = chunkText(long, 40);
  expect(chunks.every((c) => c.text.length <= 40)).toBe(true);
  expect(chunks[0]!.text.endsWith("。")).toBe(true);
  expect(chunks.map((c) => c.text).join("")).toBe(long);
  const plain = "丁".repeat(100);
  expect(chunkText(plain, 40).map((c) => c.text.length)).toEqual([40, 40, 20]);
  // 只有空白的部分不送
  expect(chunkText("  \n\n ", 40)).toEqual([]);
});

test("找到的範圍：人名、地址、單位各列一次，電話這類規則找得到的與代稱裡面的不列", () => {
  const text = "林組長說，明天到台北市中正區的大樂公司開會，林組長會帶〔人名 A〕一起去，電話 0912-345-678";
  const at = (term: string, from = 0) => {
    const start = text.indexOf(term, from);
    return { start, end: start + term.length };
  };
  const spans = [
    { kind: "person", ...at("林組長") },
    { kind: "address", ...at("台北市中正區") },
    { kind: "org", ...at("大樂公司") },
    { kind: "person", ...at("林組長", 10) },
    { kind: "person", ...at("人名") },
    { kind: "phone", ...at("0912-345-678") },
  ];
  expect(modelTerms(text, spans, ["〔人名 A〕"])).toEqual([
    { kind: "person", term: "林組長" },
    { kind: "place", term: "台北市中正區" },
    { kind: "org", term: "大樂公司" },
  ]);
});

test("找到的範圍：緊接在一起的兩段接成一個詞，只有一個字的不列", () => {
  const text = "張經理下週要去新竹科學園區開會，林說好。";
  const at = (term: string) => ({ start: text.indexOf(term), end: text.indexOf(term) + term.length });
  const park = at("新竹科學園區");
  const spans = [
    { kind: "address", start: park.start, end: park.end - 1 },
    { kind: "org", start: park.end - 1, end: park.end },
    { kind: "person", ...at("張經理") },
    { kind: "person", ...at("林") },
  ];
  expect(modelTerms(text, spans)).toEqual([
    { kind: "person", term: "張經理" },
    { kind: "place", term: "新竹科學園區" },
  ]);
});

test("找到的範圍：兩段都比較長時是不同的東西，不接", () => {
  const text = "台北市中正區重慶南路一段大樂科技公司";
  const split = text.indexOf("大樂");
  expect(modelTerms(text, [
    { kind: "address", start: 0, end: split },
    { kind: "org", start: split, end: text.length },
  ])).toEqual([
    { kind: "place", term: "台北市中正區重慶南路一段" },
    { kind: "org", term: "大樂科技公司" },
  ]);
});

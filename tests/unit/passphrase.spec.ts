import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  CHARSETS,
  entropyBits,
  makePassword,
  parseWordlist,
  passwordPoolSize,
  pickWords,
  randomBelow,
} from "../../src/tools/passphrase/index.ts";

const words = parseWordlist(readFileSync(new URL("../../src/tools/passphrase/asian-diceware-7776.txt", import.meta.url), "utf8"));

// 依序吐出固定數字的亂數來源，測試取樣邏輯
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

test("字詞表是 7776 個不重複的小寫英文字", () => {
  expect(words).toHaveLength(7776);
  expect(new Set(words).size).toBe(7776);
  expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
});

test("randomBelow 丟掉除不盡的尾巴，不會有模偏差", () => {
  const limit = 7776;
  const cutoff = 2 ** 32 - (2 ** 32 % limit);
  // 第一個值落在尾巴裡要重抽，取第二個
  expect(randomBelow(limit, sequence(cutoff, 7777))).toBe(1);
  expect(randomBelow(limit, sequence(cutoff - 1))).toBe((cutoff - 1) % limit);
  // 小範圍的分布：每個值出現的次數相同
  const counts = [0, 0, 0];
  for (let v = 0; v < 3 * 100; v++) counts[randomBelow(3, sequence(v))]!++;
  expect(counts).toEqual([100, 100, 100]);
});

test("密語的字都來自字詞表，允許重複", () => {
  const picked = pickWords(words, 6, sequence(0, 0, 1, 7775, 3, 3));
  expect(picked).toEqual([words[0], words[0], words[1], words[7775], words[3], words[3]]);
  expect(entropyBits(words.length, 6)).toBeCloseTo(77.55, 1);
});

test("隨機密碼包含每一種勾選的字元，長度正確", () => {
  for (let i = 0; i < 50; i++) {
    const pw = makePassword(["lower", "upper", "digits", "symbols"], 16, () => crypto.getRandomValues(new Uint32Array(1))[0]!);
    expect(pw).toHaveLength(16);
    for (const set of Object.values(CHARSETS)) expect([...set].some((c) => pw.includes(c))).toBe(true);
  }
  expect(makePassword(["digits"], 8, sequence(0, 1, 2, 3, 4, 5, 6, 7))).toBe("01234567");
  expect(passwordPoolSize(["lower", "upper", "digits", "symbols"])).toBe(26 + 26 + 10 + CHARSETS.symbols.length);
  expect(() => makePassword([], 8, sequence(0))).toThrow();
});

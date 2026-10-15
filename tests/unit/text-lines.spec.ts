import { expect, test } from "@playwright/test";
import { type OcrWord, textSpans } from "../../src/tools/redact/text-lines.ts";

// 一行字：每個字寬 40、間隔 10，信心分數照實際辨識的結果
const line = (y: number, ...words: [string, number][]): OcrWord[] =>
  words.map(([text, confidence], i) => ({ text, confidence, box: { x: i * 50, y, w: 40, h: 20 } }));

test("照片裡的雜訊不框：單獨的高分數字、符號與低分的碎片", () => {
  expect(
    textSpans([
      // 會議合照、太空人合照與特寫實際辨識出來的幾行
      line(0, ["TN", 38], ["1", 77], ["_—", 47], [":", 52]),
      line(30, ["圖", 72], ["圖", 89], ["|", 89], ["一", 16]),
      line(60, [":", 81], ["SPRL", 25], ["ALE", 6], ["FART)", 28], ["SSS", 33], ["|", 84]),
      line(90, ["區", 95], ["人", 51], ["a", 32], ["ry", 42]),
      line(120, ["4", 95], ["©", 29], ["人", 19], ["|", 73]),
      line(150, ["\\", 92], ["WV", 29], ["fr", 91], ["2", 65]),
    ]),
  ).toEqual([]);
});

test("截圖、文件與名牌上的文字框起來", () => {
  const spans = textSpans([
    line(0, ["我", 96], ["的", 96], ["手機", 95], ["0912-345-678", 90]),
    line(30, ["0912-345-678", 92]),
    line(60, ["Program", 96], ["Officer", 96]),
    // 照片裡的英文名牌，分數在 80 上下
    line(90, ["oe", 0], ["ARMSTRONG", 81], ["{", 61]),
  ]);
  expect(spans).toHaveLength(4);
});

test("範圍從第一個到最後一個可信的字，再延伸到相鄰、60 分以上的字", () => {
  const [head, tail, noisy] = textSpans([
    // 行首的「王」82 分，要框進來
    line(0, ["王", 82], ["小", 93], ["明", 91], ["見", 91]),
    // 行尾的「見！」65 分，要框進來
    line(30, ["好", 96], ["的", 93], ["見", 65], ["!", 65]),
    // 前後的碎片不框，中間分數低的字照樣框住
    line(60, ["=", 57], ["<i", 0], ["Jane", 95], ["和", 18], ["Doe", 95], ["和", 18]),
  ]);
  expect(head).toEqual({ x: 0, y: 0, w: 190, h: 20 });
  expect(tail).toEqual({ x: 0, y: 30, w: 190, h: 20 });
  expect(noisy).toEqual({ x: 100, y: 60, w: 140, h: 20 });
});

test("同一行遠處的高分符號不延伸進來", () => {
  const words = line(0, ["林", 96], ["小", 96], ["美", 96], ["!", 89]);
  words[3]!.box = { x: 600, y: 0, w: 6, h: 20 };
  expect(textSpans([words])).toEqual([{ x: 0, y: 0, w: 140, h: 20 }]);
});

test("同一行遠處單獨一個高分的字自成一段，不會把框拉長", () => {
  const words = line(0, ["Jane", 95], ["Doe", 95], ["4", 95]);
  words[2]!.box = { x: 800, y: 0, w: 20, h: 20 };
  expect(textSpans([words])).toEqual([{ x: 0, y: 0, w: 90, h: 20 }]);
});

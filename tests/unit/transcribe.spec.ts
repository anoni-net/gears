import { expect, test } from "@playwright/test";
import { MODELS, SAMPLE_RATE, cleanSegments, clock, collapseRepeats, maxTokens, speechPieces, toSrt, toTxt } from "../../src/tools/transcribe/segments.ts";

// 指定秒數的錄音：有聲音的範圍填 0.1 的方波，其他是靜音
function audio(seconds: number, loud: [number, number][]): Float32Array {
  const out = new Float32Array(seconds * SAMPLE_RATE);
  for (const [from, to] of loud) for (let i = from * SAMPLE_RATE; i < to * SAMPLE_RATE; i++) out[i] = i % 2 ? 0.1 : -0.1;
  return out;
}

test("模型清單：每個檔案都有 SHA-256，記錄了總大小", () => {
  for (const model of Object.values(MODELS)) {
    expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(model.dir).toContain(model.revision.slice(0, 7));
    for (const hash of Object.values(model.files)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(model.bytes).toBeGreaterThan(50e6);
  }
});

const seconds = (p: { start: number; end: number }) => [p.start / SAMPLE_RATE, p.end / SAMPLE_RATE];

test("語音偵測：靜音不送進模型", () => {
  expect(speechPieces(audio(30, []))).toEqual([]);
});

test("語音偵測：前後各留 0.2 秒，停頓不到 0.8 秒的接成同一段", () => {
  const [piece, ...rest] = speechPieces(audio(20, [[5, 8], [8.5, 10]]));
  expect(rest).toEqual([]);
  const [start, end] = seconds(piece!);
  expect(start).toBeCloseTo(4.8, 1);
  expect(end).toBeCloseTo(10.2, 1);
});

test("語音偵測：中間隔著長時間的安靜時，安靜的部分不送進模型", () => {
  const pieces = speechPieces(audio(90, [[2, 6], [70, 75]]));
  expect(pieces).toHaveLength(2);
  expect(seconds(pieces[1]!)[0]).toBeGreaterThan(69);
});

test("語音偵測：超過 30 秒的一段話切成不超過 30 秒的片段，前後相接", () => {
  const pieces = speechPieces(audio(80, [[0, 80]]));
  expect(pieces.length).toBeGreaterThanOrEqual(3);
  for (const p of pieces) expect(p.end - p.start).toBeLessThanOrEqual(30 * SAMPLE_RATE);
  for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.start).toBe(pieces[i - 1]!.end);
  expect(pieces[0]!.start).toBe(0);
  expect(pieces.at(-1)!.end).toBe(80 * SAMPLE_RATE);
});

test("語音偵測：有底噪的錄音，雜訊的基準跟著調整", () => {
  const noisy = audio(20, [[8, 12]]);
  for (let i = 0; i < noisy.length; i++) noisy[i] = noisy[i]! + (i % 3 === 0 ? 0.008 : -0.004);
  const pieces = speechPieces(noisy);
  expect(pieces).toHaveLength(1);
  const [start, end] = seconds(pieces[0]!);
  expect(start).toBeGreaterThan(7);
  expect(end).toBeLessThan(13);
});

test("整理：去掉空白、靜音的段落，前後一樣的合併，最後一段補上結束時間", () => {
  const segments = cleanSegments(
    [
      { text: " 大家好 ", timestamp: [0, 2] },
      { text: "大家好。", timestamp: [2, 3] },
      { text: "  ", timestamp: [3, 4] },
      // 靜音裡冒出來的字幕標語
      { text: "字幕由社區提供", timestamp: [5, 8] },
      { text: "今天談的是", timestamp: [9, null] },
    ],
    audio(12, [[0, 4], [9, 12]]),
  );
  expect(segments).toEqual([
    { start: 0, end: 3, text: "大家好" },
    { start: 9, end: 12, text: "今天談的是" },
  ]);
});

test("每個片段最多產生的詞元數跟著長度，30 秒時接近模型的上限", () => {
  expect(maxTokens(5 * SAMPLE_RATE)).toBe(95);
  expect(maxTokens(30 * SAMPLE_RATE)).toBe(440);
});

test("整理：短短一段的字幕標語拿掉，長的段落留著", () => {
  const segments = cleanSegments(
    [
      { text: "字幕製作曲", timestamp: [0, 2] },
      { text: "請不吝點贊 訂閱 轉發 打賞支持明鏡與點點欄目", timestamp: [2, 4] },
      { text: "我們今天要討論的是影片平台上的字幕，以及創作者如何處理訂閱者的留言", timestamp: [4, 8] },
    ],
    audio(8, [[0, 8]]),
  );
  expect(segments.map((s) => s.text)).toEqual(["我們今天要討論的是影片平台上的字幕，以及創作者如何處理訂閱者的留言"]);
});

test("重複的迴圈收成一次，正常的疊字不動", () => {
  expect(collapseRepeats("the level of the level of the level of the level of the level of")).toBe("the level of");
  expect(collapseRepeats("謝謝謝謝謝謝謝謝")).toBe("謝謝");
  expect(collapseRepeats("好好休息，慢慢來")).toBe("好好休息，慢慢來");
});

test("輸出 SRT 與 TXT", () => {
  const segments = [
    { start: 0, end: 2.5, text: "大家好" },
    { start: 3725.04, end: 3727, text: "今天先到這裡" },
  ];
  expect(toSrt(segments)).toBe("1\n00:00:00,000 --> 00:00:02,500\n大家好\n\n2\n01:02:05,040 --> 01:02:07,000\n今天先到這裡\n");
  expect(toTxt(segments)).toBe("[00:00] 大家好\n[1:02:05] 今天先到這裡\n");
  expect(clock(65)).toBe("01:05");
});

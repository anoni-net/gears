import { expect, test } from "@playwright/test";
import { PIECE_SECONDS, SAMPLE_RATE, SPLIT_GAP, VAD_WINDOW, sileroPieces, sileroRegions, speechPieces, speechTimestamps } from "../../src/tools/transcribe/segments.ts";
import street from "../helpers/silero-street10.json" with { type: "json" };

// 語音偵測換成 Silero VAD（src/tools/transcribe/segments.ts 的 speechTimestamps、sileroPieces）。
// 機率由模型算出（src/ui/silero-vad.ts），這裡只測從機率到片段的純計算

// 每窗的機率：spans 是 [開始的窗, 結束的窗（不含）, 機率]，其他是 0.01
function probs(windows: number, spans: [number, number, number][]): Float32Array {
  const out = new Float32Array(windows).fill(0.01);
  for (const [from, to, p] of spans) out.fill(p, from, to);
  return out;
}
// 秒換成窗
const w = (seconds: number) => Math.round((seconds * SAMPLE_RATE) / VAD_WINDOW);
const seconds = (p: { start: number; end: number }) => [p.start / SAMPLE_RATE, p.end / SAMPLE_RATE];

test("get_speech_timestamps：跟官方 Python 套件 6.2.3 對同一份錄音的輸出逐一相同", () => {
  const p = Float32Array.from(street.probs, (n) => n / 10000);
  expect(speechTimestamps(p, street.length)).toEqual(street.ts);
});

test("get_speech_timestamps：前後各留 30 毫秒，太短的不算，機率在兩個門檻之間不結束", () => {
  // 第 20 到 39 窗是說話：開始在 20 × 512，結束在第 40 窗，各留 480 個取樣
  expect(speechTimestamps(probs(100, [[20, 40, 0.9]]), 100 * VAD_WINDOW)).toEqual([{ start: 20 * VAD_WINDOW - 480, end: 40 * VAD_WINDOW + 480 }]);
  // 3 窗（96 毫秒）不到 250 毫秒，不算
  expect(speechTimestamps(probs(100, [[10, 13, 0.9]]), 100 * VAD_WINDOW)).toEqual([]);
  // 中間機率 0.4（在 0.35 與 0.5 之間）不算停頓
  expect(speechTimestamps(probs(100, [[20, 30, 0.9], [30, 35, 0.4], [35, 40, 0.9]]), 100 * VAD_WINDOW)).toHaveLength(1);
  // 不到 100 毫秒的停頓接成同一段
  expect(speechTimestamps(probs(100, [[20, 30, 0.9], [32, 40, 0.9]]), 100 * VAD_WINDOW)).toHaveLength(1);
  // 說到錄音的結尾時，結束在錄音的長度
  expect(speechTimestamps(probs(100, [[80, 100, 0.9]]), 100 * VAD_WINDOW - 100).at(-1)!.end).toBe(100 * VAD_WINDOW - 100);
});

test("get_speech_timestamps：兩段之間各留 30 毫秒，不重疊", () => {
  const [a, b] = speechTimestamps(probs(100, [[20, 30, 0.9], [36, 50, 0.9]]), 100 * VAD_WINDOW);
  expect(a).toEqual({ start: 20 * VAD_WINDOW - 480, end: 30 * VAD_WINDOW + 480 });
  expect(b).toEqual({ start: 36 * VAD_WINDOW - 480, end: 50 * VAD_WINDOW + 480 });
});

test("Silero 的範圍：停頓不到 0.8 秒的接成同一段", () => {
  const regions = sileroRegions(probs(w(20), [[w(2), w(5), 0.9], [w(5.5), w(8), 0.9], [w(12), w(14), 0.9]]), w(20) * VAD_WINDOW);
  expect(regions).toHaveLength(2);
});

test("Silero 的片段：空檔超過 3 秒另開片段，不到 3 秒的裝在一起，每段不超過 30 秒", () => {
  const audio = new Float32Array(60 * SAMPLE_RATE);
  // 2–6 秒、7.5–10 秒（空檔 1.5 秒）、16–20 秒（空檔 6 秒）
  const p = probs(Math.ceil(audio.length / VAD_WINDOW), [[w(2), w(6), 0.9], [w(7.5), w(10), 0.9], [w(16), w(20), 0.9]]);
  const pieces = sileroPieces(audio, p);
  expect(pieces).toHaveLength(2);
  const [first, second] = pieces.map(seconds);
  // 前後各留 0.2 秒（另有 get_speech_timestamps 的 30 毫秒與音框的進位）
  expect(first![0]).toBeGreaterThan(1.7);
  expect(first![0]).toBeLessThan(1.85);
  expect(first![1]).toBeGreaterThan(10.15);
  expect(first![1]).toBeLessThan(10.3);
  expect(second![0]).toBeGreaterThan(15.7);
  expect(second![1] - second![0]).toBeLessThan(5);
  expect(SPLIT_GAP).toBe(3);
  // 一直在說話：切成不超過 30 秒的片段，前後相接
  const long = sileroPieces(audio, probs(p.length, [[0, p.length, 0.9]]));
  expect(long.length).toBeGreaterThanOrEqual(2);
  for (const piece of long) expect(piece.end - piece.start).toBeLessThanOrEqual(PIECE_SECONDS * SAMPLE_RATE);
  for (let i = 1; i < long.length; i++) expect(long[i]!.start).toBe(long[i - 1]!.end);
  expect(long.at(-1)!.end).toBe(audio.length);
});

test("背景噪音：音量判斷整段送進模型，Silero 判斷沒有人說話時一段都不送", () => {
  // 20 秒的白噪音（固定的亂數種子），振幅 0.1
  let seed = 1;
  const noise = Float32Array.from({ length: 20 * SAMPLE_RATE }, () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return (seed / 2 ** 31 - 0.5) * 0.2;
  });
  const energy = speechPieces(noise);
  expect(energy.reduce((sum, p) => sum + p.end - p.start, 0)).toBeGreaterThan(19 * SAMPLE_RATE);
  // 模型對噪音的機率很低（評測的純噪音檔，Silero 一段都沒有送進 Whisper）
  expect(sileroPieces(noise, probs(Math.ceil(noise.length / VAD_WINDOW), [[0, 10, 0.2]]))).toEqual([]);
});

test("空的錄音沒有片段", () => {
  expect(sileroPieces(new Float32Array(0), new Float32Array(0))).toEqual([]);
});

import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ASR_SAMPLE, asrCer } from "../../src/tools/bench/asr.ts";
import { wavLayout } from "../../src/tools/transcribe/sources.ts";

// 裝置量測的逐字稿範例（src/tools/bench/asr.ts）：檔案跟清單對得上，量測頁不必在瀏覽器裡解碼
test("範例錄音：SHA-256、大小與長度跟清單相同，是 16 kHz 單聲道 16 位元的 WAV", () => {
  const bytes = new Uint8Array(readFileSync(`public/${ASR_SAMPLE.file}`));
  expect(bytes.length).toBe(ASR_SAMPLE.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(ASR_SAMPLE.sha256);
  const layout = wavLayout(bytes, bytes.length)!;
  expect(layout).toMatchObject({ sampleRate: 16000, channels: 1, bits: 16, float: false });
  expect(layout.dataLength / 2 / 16000).toBeCloseTo(ASR_SAMPLE.seconds, 1);
  expect(ASR_SAMPLE.source.license).toBe("CC-BY-4.0");
  // 正確答案是正體字，跟逐字稿的輸出比得起來
  expect(ASR_SAMPLE.lines.join("")).toContain("望遠鏡");
});

test("逐字稿的字錯率：不算標點、空白與英文大小寫", () => {
  expect(asrCer("大多數現代科研望遠鏡", "大多數，現代 科研望遠鏡。")).toBe(0);
  expect(asrCer("Hello 世界", "hello世界")).toBe(0);
  expect(asrCer("望遠鏡都是", "望遠鏡都事")).toBeCloseTo(0.2);
  expect(asrCer("", "")).toBe(0);
});

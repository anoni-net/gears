// 裝置量測的個資辨識（src/ui/PiiBench.tsx）的 Worker：載入 nym-pii（下載與設定在 pii-runtime.ts，遮蔽也用同一份），
// 辨識內建的三段虛構文字，回報下載量、載入時間與每段的辨識時間。
// 2026-11-21 起每段的時間包含詞元對回原文（遮蔽實際用的流程），之前只量模型本身，兩者差幾毫秒
import type { PiiSpan } from "../tools/redact/pii-model.ts";
import { loadPii } from "./pii-runtime.ts";

export interface PiiBenchRequest {
  device: "wasm" | "webgpu";
  threads: number;
  repeat: number;
  samples: { id: string; text: string }[];
}

export type PiiBenchReply =
  | { type: "download"; loaded: number; total: number }
  | { type: "loaded"; ms: number; bytes: number; isolated: boolean }
  | { type: "sample"; id: string; round: number; ms: number; tokens: number; spans?: PiiSpan[] }
  | { type: "done" }
  | { type: "error"; message: string };

const post = (reply: PiiBenchReply) => self.postMessage(reply);

self.onmessage = async ({ data }: MessageEvent<PiiBenchRequest>) => {
  try {
    const start = performance.now();
    const pii = await loadPii({ device: data.device, threads: data.threads, onDownload: (loaded, total) => post({ type: "download", loaded, total }) });
    post({ type: "loaded", ms: performance.now() - start, bytes: pii.downloaded, isolated: self.crossOriginIsolated });
    // 第一輪包含暖機（WebGPU 第一次執行要編譯 shader），每段量 repeat 次，畫面上取中位數。
    // 第一輪才把找到的範圍送回去，確認每種設定找到的一樣
    for (let round = 0; round < data.repeat; round++) {
      for (const sample of data.samples) {
        const begin = performance.now();
        const { spans, tokens } = await pii.detect(sample.text);
        post({ type: "sample", id: sample.id, round, ms: performance.now() - begin, tokens, spans: round === 0 ? spans : undefined });
      }
    }
    await pii.dispose();
    post({ type: "done" });
  } catch (error) {
    post({ type: "error", message: String((error as Error)?.message ?? error) });
  }
};

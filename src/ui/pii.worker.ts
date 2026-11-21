// 遮蔽用的個資辨識（src/ui/pii-detect.ts）的 Worker：第一次收到文字時載入 nym-pii（pii-runtime.ts），
// 之後留著，同一個編輯畫面再找一次不必重新載入。只用 CPU 的單執行緒 WebAssembly，跟找人臉與辨識文字一樣
import type { PiiSpan } from "../tools/redact/pii-model.ts";
import { type PiiRuntime, loadPii } from "./pii-runtime.ts";

export interface PiiRequest {
  texts: string[];
}

export type PiiReply =
  | { type: "download"; loaded: number; total: number }
  | { type: "loaded" }
  | { type: "result"; spans: PiiSpan[][] }
  | { type: "error"; message: string };

const post = (reply: PiiReply) => self.postMessage(reply);

let runtime: Promise<PiiRuntime> | null = null;

self.onmessage = async ({ data }: MessageEvent<PiiRequest>) => {
  try {
    if (!runtime) {
      runtime = loadPii({ device: "wasm", threads: 1, onDownload: (loaded, total) => post({ type: "download", loaded, total }) });
      runtime.catch(() => (runtime = null));
    }
    const pii = await runtime;
    post({ type: "loaded" });
    const spans: PiiSpan[][] = [];
    for (const text of data.texts) spans.push((await pii.detect(text)).spans);
    post({ type: "result", spans });
  } catch (error) {
    post({ type: "error", message: String((error as Error)?.message ?? error) });
  }
};

// 裝置量測的個資辨識（src/ui/PiiBench.tsx）的 Worker：從 Hugging Face 下載 nym-pii 的 q4 版，
// 辨識內建的三段虛構文字，回報下載量、載入時間與每段的辨識時間。
// Transformers.js 的設定照 llm-bench.worker.ts：鎖定 commit、不帶 cookie 與 Referer、
// WebAssembly 用 ?url 從自己的網域載入，下載的檔案存在 transformers-cache。
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { type Decoder, PII_MODEL, type PiiSpan, align, argmax, groupSpans, labelKind } from "../tools/bench/pii.ts";

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

const files: Record<string, [number, number]> = {};
let downloaded = 0;
function counted(response: Response, key: string): Response {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) return response;
  let loaded = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.length;
        downloaded += chunk.length;
        files[key] = [loaded, total];
        const sum = Object.values(files).reduce((a, [l, t]) => [a[0]! + l, a[1]! + t], [0, 0]);
        post({ type: "download", loaded: sum[0]!, total: sum[1]! });
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

self.onmessage = async ({ data }: MessageEvent<PiiBenchRequest>) => {
  try {
    const { AutoModelForTokenClassification, AutoTokenizer, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    // WebAssembly 的載入程式不存快取：存了之後改用 blob: 網址載入，CSP 的 script-src 不允許
    env.useWasmCache = false;
    // Transformers.js 有幾處讀檔沒有把 revision 傳下去，直接把下載路徑鎖在這個 commit
    env.remotePathTemplate = `{model}/resolve/${PII_MODEL.revision}/`;
    env.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      return fetch(input, { ...init, credentials: "omit", referrerPolicy: "no-referrer" }).then(
        (r) => counted(r, url),
        (error: Error) => {
          throw new Error(`${error.message}（${url}）`);
        },
      );
    };
    const wasm = env.backends.onnx.wasm!;
    const asyncify = JSON.stringify(wasm.wasmPaths ?? "").includes(".asyncify");
    wasm.wasmPaths = asyncify ? { mjs: asyncifyMjs, wasm: asyncifyWasm } : { mjs: plainMjs, wasm: plainWasm };
    wasm.numThreads = self.crossOriginIsolated ? data.threads : 1;

    const start = performance.now();
    const options = { revision: PII_MODEL.revision };
    const tokenizer = await AutoTokenizer.from_pretrained(PII_MODEL.repo, options);
    const net = await AutoModelForTokenClassification.from_pretrained(PII_MODEL.repo, { ...options, device: data.device, dtype: PII_MODEL.dtype });
    post({ type: "loaded", ms: performance.now() - start, bytes: downloaded, isolated: self.crossOriginIsolated });

    const id2label = (net.config as unknown as { id2label: Record<number, string> }).id2label;
    // 第一輪包含暖機（WebGPU 第一次執行要編譯 shader），每段量 repeat 次，畫面上取中位數
    for (let round = 0; round < data.repeat; round++) {
      for (const sample of data.samples) {
        const begin = performance.now();
        const inputs = tokenizer(sample.text, { truncation: true });
        const { logits } = (await net(inputs)) as { logits: { data: Float32Array; dims: number[] } };
        const ms = performance.now() - begin;
        const [, n, labels] = logits.dims as [number, number, number];
        let spans: PiiSpan[] | undefined;
        if (round === 0) {
          // 第一輪才把詞元對回原文，確認每種設定找到的一樣
          const ids = (inputs.input_ids.tolist() as number[][])[0]!.map(Number);
          const at = align(tokenizer as unknown as Decoder, sample.text, ids);
          const items = [];
          for (let j = 0; j < n; j++) {
            const range = at[j];
            if (!range) continue;
            const kind = labelKind(id2label[argmax(logits.data.subarray(j * labels, (j + 1) * labels))] ?? "");
            if (kind) items.push({ kind, start: range[0], end: range[1] });
          }
          spans = groupSpans(sample.text, items);
        }
        post({ type: "sample", id: sample.id, round, ms, tokens: n, spans });
      }
    }
    await net.dispose();
    post({ type: "done" });
  } catch (error) {
    post({ type: "error", message: String((error as Error)?.message ?? error) });
  }
};

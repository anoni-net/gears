/// <reference lib="webworker" />
// Transformers.js 帶著自己的 onnxruntime-web（版本跟找人臉用的不同），WebAssembly 要用它那一份。
// 不指定的話 Transformers.js 會從 jsDelivr 的 CDN 載入，Worker 不受頁面 meta 標籤的 CSP
// 約束，請求真的會送出去
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { MODELS, type ModelId, type RawChunk, SAMPLE_RATE, maxTokens, speechPieces } from "../tools/transcribe/segments.ts";

// 逐字稿的辨識在這個 Web Worker 裡執行，畫面不會卡住。用 Transformers.js 跑 Whisper，
// 模型與 WebAssembly 都從自己的網域載入：關掉 Hugging Face 的下載，也不另外寫進
// Transformers.js 自己的快取（離線快取由 service worker 處理，見 src/sw/sw-template.js）。
// 錄音只在這個分頁的記憶體裡，不會送出去。

// threads 是同時使用的 CPU 核心數。onnxruntime 在第一次載入時就決定了執行緒數，
// 換核心數要換一個新的 Worker（src/ui/TranscribeEditor.tsx）
export type Request = { type: "run"; model: ModelId; audio: Float32Array; language: "zh" | null; base: string; threads: number };

export type Reply =
  | { type: "download"; loaded: number; total: number }
  | { type: "recognize"; done: number; total: number }
  | { type: "result"; chunks: RawChunk[] }
  | { type: "error"; message: string };

const post = (reply: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);

type Pipeline = ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ chunks?: RawChunk[] }>) & { dispose(): Promise<void> };
let loaded: { model: ModelId; asr: Pipeline } | null = null;
let convert: ((text: string) => string) | null = null;

async function load(model: ModelId, base: string, threads: number): Promise<Pipeline> {
  if (loaded?.model === model) return loaded.asr;
  // 換模型時先放掉舊的，兩個模型不同時佔著記憶體
  if (loaded) await loaded.asr.dispose();
  loaded = null;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // 只給路徑，完整網址（http://…）在 Transformers.js 組路徑時會被弄壞
  env.localModelPath = `${new URL(base).pathname}models/whisper/`;
  env.useBrowserCache = false;
  env.useWasmCache = false;
  // 模型檔最大 157 MB，瀏覽器的 HTTP 快取（尤其無痕視窗的記憶體快取）寫不下時整個請求會失敗。
  // 離線快取已經由 service worker 處理，這裡不寫 HTTP 快取
  env.fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: "no-store" });
  // Transformers.js 載入時填上了 CDN 的網址，換成自己網域上的同一個檔案。舊版 Safari 用的是
  // 沒有 asyncify 的版本，照它的選擇
  const wasmEnv = env.backends.onnx.wasm!;
  const asyncify = JSON.stringify(wasmEnv.wasmPaths ?? "").includes(".asyncify");
  wasmEnv.wasmPaths = asyncify ? { mjs: asyncifyMjs, wasm: asyncifyWasm } : { mjs: plainMjs, wasm: plainWasm };
  // 多執行緒要頁面在 cross-origin isolation 底下（伺服器送 COOP 與 COEP 標頭），沒有時用單執行緒
  wasmEnv.numThreads = self.crossOriginIsolated ? threads : 1;
  const files: Record<string, number> = {};
  const asr = (await pipeline("automatic-speech-recognition", MODELS[model].dir, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (info: { status: string; file?: string; loaded?: number }) => {
      if (info.status !== "progress" || !info.file) return;
      files[info.file] = info.loaded ?? 0;
      post({ type: "download", loaded: Object.values(files).reduce((a, b) => a + b, 0), total: MODELS[model].bytes });
    },
  })) as unknown as Pipeline;
  loaded = { model, asr };
  return asr;
}

// Whisper 的中文常輸出簡體，轉成台灣正體與台灣慣用詞
async function toTaiwan(text: string): Promise<string> {
  if (!convert) {
    const OpenCC = await import("opencc-js/cn2t");
    convert = OpenCC.Converter({ from: "cn", to: "twp" });
  }
  return convert(text);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { model, audio, language, base, threads } = event.data;
  try {
    const asr = await load(model, base, threads);
    // 只辨識有人說話的片段（語音偵測見 src/tools/transcribe/segments.ts），每段不超過 30 秒
    const pieces = speechPieces(audio);
    post({ type: "recognize", done: 0, total: pieces.length });
    const raw: RawChunk[] = [];
    for (const [i, piece] of pieces.entries()) {
      const offset = piece.start / SAMPLE_RATE;
      const out = await asr(audio.subarray(piece.start, piece.end), {
        language: language ?? undefined,
        task: "transcribe",
        return_timestamps: true,
        max_new_tokens: maxTokens(piece.end - piece.start),
      });
      for (const chunk of out.chunks ?? []) {
        const [start, end] = chunk.timestamp;
        raw.push({ text: chunk.text, timestamp: [start + offset, end === null ? piece.end / SAMPLE_RATE : end + offset] });
      }
      post({ type: "recognize", done: i + 1, total: pieces.length });
    }
    const chunks: RawChunk[] = [];
    for (const chunk of raw) chunks.push({ ...chunk, text: await toTaiwan(chunk.text) });
    post({ type: "result", chunks });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

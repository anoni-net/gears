/// <reference lib="webworker" />
// Transformers.js 帶著自己的 onnxruntime-web（版本跟找人臉用的不同），WebAssembly 要用它那一份。
// 不指定的話 Transformers.js 會從 jsDelivr 的 CDN 載入，Worker 不受頁面 meta 標籤的 CSP
// 約束，請求真的會送出去
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { MODELS, type ModelId, type RawChunk, SAMPLE_RATE, type Segment, cleanSegments, maxTokens, speechPieces } from "../tools/transcribe/segments.ts";

// 逐字稿的辨識在這個 Web Worker 裡執行，畫面不會卡住。用 Transformers.js 跑 Whisper，
// 模型與 WebAssembly 都從自己的網域載入：關掉 Hugging Face 的下載，也不另外寫進
// Transformers.js 自己的快取（離線快取由 service worker 處理，見 src/sw/sw-template.js）。
// 錄音只在這個分頁的記憶體裡，不會送出去。

// 長錄音分段送進來（src/ui/audio-stream.ts 每次解碼約 10 分鐘），一段處理完回覆 done，
// 畫面才送下一段，記憶體裡同時只有一段。
//
// threads 是同時使用的 CPU 核心數。onnxruntime 在第一次載入時就決定了執行緒數，
// 換核心數要換一個新的 Worker（src/ui/TranscribeEditor.tsx）
export type Request =
  | { type: "start"; model: ModelId; language: "zh" | null; base: string; threads: number }
  | { type: "chunk"; audio: Float32Array; offset: number; last: boolean };

export type Reply =
  | { type: "download"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "progress"; at: number } // 處理到第幾秒
  | { type: "segments"; segments: Segment[] }
  | { type: "done" }
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

let job: { asr: Pipeline; language: "zh" | null } | null = null;
// 碰到這一段結尾的最後一句話先留著，接到下一段一起辨識，一句話才不會被切成兩半
let carry: { audio: Float32Array; offset: number } | null = null;

async function recognize(chunk: Float32Array, at: number, last: boolean) {
  const { asr, language } = job!;
  const audio = carry ? concat(carry.audio, chunk) : chunk;
  const offset = carry ? carry.offset : at;
  carry = null;
  // 只辨識有人說話的片段（語音偵測見 src/tools/transcribe/segments.ts），每段不超過 30 秒
  let pieces = speechPieces(audio);
  const tail = pieces.at(-1);
  if (!last && tail && tail.end >= audio.length - 0.3 * SAMPLE_RATE) {
    carry = { audio: audio.slice(tail.start), offset: offset + tail.start / SAMPLE_RATE };
    pieces = pieces.slice(0, -1);
  }
  const raw: RawChunk[] = [];
  for (const piece of pieces) {
    const start = offset + piece.start / SAMPLE_RATE;
    const out = await asr(audio.subarray(piece.start, piece.end), {
      language: language ?? undefined,
      task: "transcribe",
      return_timestamps: true,
      max_new_tokens: maxTokens(piece.end - piece.start),
    });
    for (const c of out.chunks ?? []) {
      const [s, e] = c.timestamp;
      raw.push({ text: await toTaiwan(c.text), timestamp: [s + start, e === null ? offset + piece.end / SAMPLE_RATE : e + start] });
    }
    post({ type: "progress", at: offset + piece.end / SAMPLE_RATE });
  }
  post({ type: "segments", segments: cleanSegments(raw, audio, offset) });
  post({ type: "progress", at: carry ? carry.offset : offset + audio.length / SAMPLE_RATE });
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.type === "start") {
      carry = null;
      job = { asr: await load(request.model, request.base, request.threads), language: request.language };
      post({ type: "ready" });
    } else {
      await recognize(request.audio, request.offset, request.last);
      post({ type: "done" });
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

/// <reference lib="webworker" />
// Transformers.js 帶著自己的 onnxruntime-web（版本跟找人臉用的不同），WebAssembly 要用它那一份。
// 不指定的話 Transformers.js 會從 jsDelivr 的 CDN 載入，Worker 不受頁面 meta 標籤的 CSP
// 約束，請求真的會送出去
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { type Part, joinParts, partName } from "../tools/transcribe/parts.ts";
import { REMOTE_ERROR, hfUrl, readVerified } from "../tools/transcribe/remote.ts";
import { MODELS, type ModelId, type RawChunk, SAMPLE_RATE, type Segment, cleanSegments, maxTokens, speechPieces } from "../tools/transcribe/segments.ts";
import { MIN_EMBED_SECONDS, assignSpeakers, normalize } from "../tools/transcribe/speakers.ts";
import type { Device } from "../tools/transcribe/device.ts";
import { type Language, isChinese } from "../tools/transcribe/languages.ts";
import speakerModel from "../tools/transcribe/speaker-model.json" with { type: "json" };
import type { Embedder } from "./speaker-embed.ts";

// 逐字稿的辨識在這個 Web Worker 裡執行，畫面不會卡住。用 Transformers.js 跑 Whisper，
// 模型與 WebAssembly 都從自己的網域載入：關掉 Transformers.js 內建的 Hugging Face 下載，
// 也不另外寫進 Transformers.js 自己的快取（離線快取由 service worker 處理，見
// src/sw/sw-template.js）。標成 remote 的大模型例外，讀者選擇之後由 remoteFetch 從
// Hugging Face 下載，比對 SHA-256 之後存進同一個快取。錄音只在這個分頁的記憶體裡，不會送出去。

// 長錄音分段送進來（src/ui/audio-stream.ts 每次解碼約 10 分鐘），一段處理完回覆 done，
// 畫面才送下一段，記憶體裡同時只有一段。
//
// threads 是同時使用的 CPU 核心數。onnxruntime 在第一次載入時就決定了執行緒數，
// 換核心數要換一個新的 Worker（src/ui/TranscribeEditor.tsx）
export type Request =
  | { type: "start"; model: ModelId; language: Language; base: string; threads: number; speakers: boolean; device: Device }
  | { type: "chunk"; audio: Float32Array; offset: number; last: boolean };

export type Reply =
  | { type: "download"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "device"; device: Device } // 拿不到顯示卡，在這個 Worker 裡改用 CPU
  | { type: "progress"; at: number } // 處理到第幾秒
  | { type: "segments"; segments: Segment[] }
  | { type: "speakers"; speakers: { start: number; speaker: number }[] } // 每段的說話者，最後一段處理完才送
  | { type: "done" }
  | { type: "error"; message: string };

const post = (reply: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);

type Pipeline = ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ chunks?: RawChunk[] }>) & { dispose(): Promise<void> };
let loaded: { model: ModelId; device: Device; asr: Pipeline } | null = null;
let convert: ((text: string) => string) | null = null;
// 每個檔案下載了多少位元組，加總之後回報給畫面
let files: Record<string, number> = {};
let downloadTotal = 0;
const reportDownload = () => post({ type: "download", loaded: Object.values(files).reduce((a, b) => a + b, 0), total: downloadTotal });

const MODEL_CACHE = "gears-models";
// Transformers.js 會把 env.fetch 的錯誤換成「找不到檔案」，下載失敗的原因另外記下來回報
let remoteError: Error | null = null;

// 模型檔讀到多少位元組就回報給畫面
function counted(response: Response, file: string): Response {
  if (!response.ok || !response.body) return response;
  let n = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        n += chunk.length;
        files[file] = n;
        reportDownload();
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// 大模型的檔案：先找快取，沒有就從 Hugging Face 下載、比對 SHA-256，存進快取再交給
// Transformers.js。快取的網址跟 small、base 一樣用自己網域的路徑，畫面判斷「已下載」與
// 刪除模型時不必分開處理
//
// 同一個檔案同時有好幾個請求時共用同一次下載。存進快取的回傳 null，存不進去的（無痕視窗的
// 配額很小）把內容留在這裡，載入完才放掉
const downloads = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();

async function remoteFetch(model: ModelId, file: string, url: string): Promise<Response> {
  const info = MODELS[model];
  const sha256 = (info.files as Record<string, string>)[file];
  // Transformers.js 會試著讀一些選用的檔案，清單以外的當作不存在，不送到 Hugging Face
  if (!sha256) return new Response(null, { status: 404 });
  // Firefox 的無痕視窗不能用 Cache API，那時每次都重新下載
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit;
  let job = downloads.get(url);
  if (!job) {
    job = download(model, file, sha256, url, cache);
    downloads.set(url, job);
  }
  const data = await job;
  const stored = data ? undefined : await cache?.match(url);
  return stored ?? new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(data?.length ?? 0) } });
}

async function download(model: ModelId, file: string, sha256: string, url: string, cache: Cache | null): Promise<Uint8Array<ArrayBuffer> | null> {
  const info = MODELS[model];
  const response = await fetch(hfUrl(info.repo, info.revision, file), { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" }).catch((error: Error) => {
    throw new Error(`${REMOTE_ERROR}: ${error.message}`);
  });
  if (!response.ok) throw new Error(`${REMOTE_ERROR}: HTTP ${response.status} (${file})`);
  const data = await readVerified(response, sha256, (n) => {
    files[file] = n;
    reportDownload();
  });
  if (!cache) return data;
  const headers = { "content-type": "application/octet-stream", "content-length": String(data.length) };
  return cache.put(url, new Response(data, { headers })).then(
    () => null,
    (error: Error) => {
      console.warn("[gears] 模型存不進快取：", file, error.message);
      return data;
    },
  );
}

async function load(model: ModelId, base: string, threads: number, device: Device): Promise<Pipeline> {
  if (loaded?.model === model && loaded.device === device) return loaded.asr;
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
  const dir = `${new URL(base).pathname}models/whisper/${MODELS[model].dir}/`;
  env.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), self.location.href);
    if (MODELS[model].remote && url.pathname.startsWith(dir))
      return remoteFetch(model, url.pathname.slice(dir.length), url.href).catch((error: Error) => {
        remoteError = error;
        throw error;
      });
    if (!url.pathname.startsWith(dir)) return fetch(input, { ...init, cache: "no-store" });
    const file = url.pathname.slice(dir.length);
    // 切成好幾段的檔案逐段下載、比對、接回來（src/tools/transcribe/parts.ts）
    const parts = (MODELS[model] as { parts?: Record<string, Part[]> }).parts?.[file];
    if (parts)
      return joinParts(
        parts,
        (i) => fetch(new URL(partName(file, i), new URL(dir, self.location.href)), { cache: "no-store" }),
        (n) => {
          files[file] = n;
          reportDownload();
        },
      ).then((data) => new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(data.length) } }));
    return fetch(input, { ...init, cache: "no-store" }).then((r) => counted(r, file));
  };
  // Transformers.js 載入時填上了 CDN 的網址，換成自己網域上的同一個檔案。舊版 Safari 用的是
  // 沒有 asyncify 的版本，照它的選擇
  const wasmEnv = env.backends.onnx.wasm!;
  const asyncify = JSON.stringify(wasmEnv.wasmPaths ?? "").includes(".asyncify");
  wasmEnv.wasmPaths = asyncify ? { mjs: asyncifyMjs, wasm: asyncifyWasm } : { mjs: plainMjs, wasm: plainWasm };
  // 多執行緒要頁面在 cross-origin isolation 底下（伺服器送 COOP 與 COEP 標頭），沒有時用單執行緒
  wasmEnv.numThreads = self.crossOriginIsolated ? threads : 1;
  const asr = (await pipeline("automatic-speech-recognition", MODELS[model].dir, {
    // WebGPU 用 4 位元的模型（src/tools/transcribe/device.ts）
    dtype: (device === "webgpu" ? MODELS[model].webgpu.dtype : MODELS[model].dtype) as "q8" | "q4",
    device,
    // 不傳 progress_callback：有它時 Transformers.js 會先對每個檔案發一次完整的 GET 查大小，
    // 回應的內容不讀。大模型會因此多下載一次，這些沒讀完的連線還會佔住瀏覽器對同一個主機的
    // 連線數。實測 Firefox 從開始到能辨識，base 要兩分鐘（改了之後 9 秒），用多個核心時約四分之一
    // 的機率整個停住。下載進度改由 env.fetch 計算（counted）
  }).finally(() => downloads.clear())) as unknown as Pipeline;
  loaded = { model, device, asr };
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

// 分辨說話者的聲紋模型（src/ui/speaker-embed.ts），勾選時才載入，載入一次就留著
let embedder: Embedder | null = null;
// 每段的聲紋，最後一段處理完一起分群。太短的段落是 null
let voices: { start: number; seconds: number; embedding: Float32Array | null }[] = [];

let job: { asr: Pipeline; language: Language; speakers: boolean } | null = null;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const gpuAdapter = () =>
  (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter().catch(() => null) ?? Promise.resolve(null);
const modelBytes = (model: ModelId, device: Device) => (device === "webgpu" ? MODELS[model].webgpu.bytes : MODELS[model].bytes);
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
      // 一定要指定語言：Transformers.js 沒有語言偵測，不指定時一律當成英文（src/tools/transcribe/languages.ts）
      language,
      task: "transcribe",
      return_timestamps: true,
      max_new_tokens: maxTokens(piece.end - piece.start),
    });
    for (const c of out.chunks ?? []) {
      const [s, e] = c.timestamp;
      raw.push({ text: isChinese(language) ? await toTaiwan(c.text) : c.text, timestamp: [s + start, e === null ? offset + piece.end / SAMPLE_RATE : e + start] });
    }
    post({ type: "progress", at: offset + piece.end / SAMPLE_RATE });
  }
  const segments = cleanSegments(raw, audio, offset, isChinese(language));
  post({ type: "segments", segments });
  if (job!.speakers) {
    for (const seg of segments) {
      const seconds = seg.end - seg.start;
      const from = Math.max(0, Math.round((seg.start - offset) * SAMPLE_RATE));
      const to = Math.min(audio.length, Math.round((seg.end - offset) * SAMPLE_RATE));
      const embedding = seconds >= MIN_EMBED_SECONDS && to > from ? normalize(await embedder!(audio.subarray(from, to))) : null;
      voices.push({ start: seg.start, seconds, embedding });
    }
    if (last) {
      const labels = assignSpeakers(
        voices.map((v) => v.embedding),
        voices.map((v) => v.seconds),
      );
      post({ type: "speakers", speakers: voices.map((v, i) => ({ start: v.start, speaker: labels[i]! })) });
    }
  }
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
      remoteError = null;
      voices = [];
      files = {};
      downloadTotal = modelBytes(request.model, request.device) + (request.speakers && !embedder ? speakerModel.bytes : 0);
      // 畫面問過瀏覽器才選 WebGPU。Worker 拿不到 adapter 時直接改用 CPU，不白白下載 4 位元的模型，
      // onnxruntime 也還沒初始化，不必換 Worker。其他顯示卡的錯誤由畫面換一個新的 Worker 改用 CPU
      // （src/ui/TranscribeEditor.tsx）
      let device = request.device;
      if (device === "webgpu" && !(await gpuAdapter())) {
        console.warn("[gears] Worker 拿不到顯示卡，改用 CPU");
        device = "wasm";
        downloadTotal = modelBytes(request.model, device) + (request.speakers && !embedder ? speakerModel.bytes : 0);
        post({ type: "device", device });
      }
      const asr = await load(request.model, request.base, request.threads, device);
      // 聲紋模型在 Whisper 之後載入，onnxruntime 的設定（WebAssembly 的位置、執行緒數）已經就緒
      if (request.speakers && !embedder) {
        const { speakerEmbedder } = await import("./speaker-embed.ts");
        embedder = await speakerEmbedder(`${request.base}models/speaker/${speakerModel.dir}/${speakerModel.file}`, speakerModel.bytes, (n) => {
          files.speaker = n;
          reportDownload();
        });
      }
      job = { asr, language: request.language, speakers: request.speakers };
      post({ type: "ready" });
    } else {
      await recognize(request.audio, request.offset, request.last);
      post({ type: "done" });
    }
  } catch (error) {
    post({ type: "error", message: remoteError?.message ?? message(error) });
  }
};

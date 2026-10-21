/// <reference lib="webworker" />
import { assetsUrl, cachedModel, downloadVerified, forgetDownloads } from "../core/models.ts";
import { MODELS, type ModelId, type RawChunk, SAMPLE_RATE, cleanSegments, speechPieces } from "../tools/transcribe/segments.ts";
import type { Reply, Request } from "./transcribe.worker.ts";

// Whisper 辨識不好的語言（緬甸、高棉、寮、孟加拉、尼泊爾、蒙古）用 Meta 的 Omnilingual ASR，
// 在這個 Worker 裡用 sherpa-onnx 的 WebAssembly 執行。Transformers.js 不支援這個架構。
//
// sherpa-onnx 是社群自己建置的 ES module 版（public/vendor/sherpa/，來源與建置方式見
// AGENTS.md），從自己的網域載入。模型從 assets.anoni.net 下載、比對 SHA-256，存進跟 Whisper
// 同一個快取，再寫進 Emscripten 的檔案系統建立辨識器。只能用 1 個核心，不能用顯示卡。
//
// 訊息的格式跟 src/ui/transcribe.worker.ts 相同，畫面依模型的 engine 決定開哪一個 Worker。
// 語音偵測、長錄音分段與接縫的處理也一樣。

const post = (reply: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);

interface Stream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}
interface Recognizer {
  handle: number;
  createStream(): Stream;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text: string };
  free(): void;
}

// 各模型在 sherpa-onnx 的設定，檔名是 models.json 的 files
const CONFIG: Partial<Record<ModelId, (dir: string) => Record<string, unknown>>> = {
  omni: (dir) => ({ omnilingual: { model: `${dir}model.int8.onnx` }, tokens: `${dir}tokens.txt` }),
};

let loaded: { model: ModelId; recognizer: Recognizer } | null = null;
// sherpa-onnx 寫到標準錯誤輸出的最後幾行，建立辨識器失敗時附在錯誤訊息裡
const stderr: string[] = [];

let files: Record<string, number> = {};
let total = 0;
const report = () => post({ type: "download", loaded: Object.values(files).reduce((a, b) => a + b, 0), total });

// 模型檔：先找快取，沒有就從 assets.anoni.net 下載、比對 SHA-256、存進快取（src/core/models.ts）。
// 快取的網址跟 Whisper 一樣用自己網域的路徑，畫面判斷「已下載」與刪除模型時不必分開處理
async function modelFile(model: ModelId, file: string, base: string): Promise<Uint8Array> {
  const info = MODELS[model];
  const sha256 = (info.files as Record<string, string>)[file]!;
  const onBytes = (n: number) => {
    files[file] = n;
    report();
  };
  const response = await cachedModel(`${base}models/whisper/${info.dir}/${file}`, () => downloadVerified({ url: (name) => assetsUrl(info.dir, name), file, sha256 }, onBytes));
  const data = new Uint8Array(await response.arrayBuffer());
  onBytes(data.length);
  return data;
}

async function load(model: ModelId, base: string): Promise<Recognizer> {
  if (loaded?.model === model) return loaded.recognizer;
  loaded?.recognizer.free();
  loaded = null;
  const config = CONFIG[model];
  if (!config) throw new Error(`sherpa-onnx: no config for ${model}`);
  const vendor = `${base}vendor/sherpa/`;
  const { default: SherpaOnnx } = (await import(/* @vite-ignore */ `${vendor}sherpa-onnx-wasm-web.js`)) as {
    default: (options: Record<string, unknown>) => Promise<SherpaModule>;
  };
  const { OfflineRecognizer } = (await import(/* @vite-ignore */ `${vendor}sherpa-onnx-asr.mjs`)) as {
    OfflineRecognizer: new (config: Record<string, unknown>, module: SherpaModule) => Recognizer;
  };
  // Emscripten 預設把標準錯誤輸出寫成 console.error，這裡只留著出錯時用
  const Module = await SherpaOnnx({
    print: () => {},
    printErr: (line: string) => {
      stderr.push(line);
      if (stderr.length > 5) stderr.shift();
    },
  });
  // 模型寫進 Emscripten 的檔案系統，建立辨識器之後刪掉，放掉這一份
  const dir = "/m/";
  Module.FS.mkdirTree(dir);
  const names = Object.keys(MODELS[model].files);
  for (const name of names) Module.FS.writeFile(dir + name, await modelFile(model, name, base));
  forgetDownloads();
  const recognizer = new OfflineRecognizer(
    { featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 }, modelConfig: { ...config(dir), numThreads: 1, provider: "cpu", debug: 0 }, decodingMethod: "greedy_search" },
    Module,
  );
  for (const name of names) Module.FS.unlink(dir + name);
  if (!recognizer.handle) throw new Error(`sherpa-onnx: ${stderr.join(" | ") || "cannot create the recognizer"}`);
  loaded = { model, recognizer };
  return recognizer;
}

interface SherpaModule {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
}

let job: { recognizer: Recognizer } | null = null;
// 碰到這一段結尾的最後一句話先留著，接到下一段一起辨識，一句話才不會被切成兩半
let carry: { audio: Float32Array; offset: number } | null = null;

function recognize(chunk: Float32Array, at: number, last: boolean) {
  const { recognizer } = job!;
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
    const stream = recognizer.createStream();
    stream.acceptWaveform(SAMPLE_RATE, audio.subarray(piece.start, piece.end));
    recognizer.decode(stream);
    const { text } = recognizer.getResult(stream);
    stream.free();
    // CTC 模型沒有段落的時間，一個片段一段
    raw.push({ text, timestamp: [offset + piece.start / SAMPLE_RATE, offset + piece.end / SAMPLE_RATE] });
    post({ type: "progress", at: offset + piece.end / SAMPLE_RATE });
  }
  post({ type: "segments", segments: cleanSegments(raw, audio, offset, false) });
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
      files = {};
      total = MODELS[request.model].bytes;
      job = { recognizer: await load(request.model, request.base) };
      post({ type: "ready" });
    } else {
      recognize(request.audio, request.offset, request.last);
      post({ type: "done" });
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

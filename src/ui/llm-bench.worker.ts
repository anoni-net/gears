// 裝置量測的語言模型（src/ui/LlmBench.tsx）的 Worker：從 Hugging Face 下載模型、
// 改寫範例文字，回報載入時間、第一個字出現的時間與每秒的詞元數。
//
// 模型鎖定 commit（src/tools/llm-bench/models.json），伺服器送的 CSP 只開這幾個下載路徑。
// 社群轉檔的模型（host 是 assets）從 assets.anoni.net 下載，每個檔案比對 SHA-256，大檔案逐段接回來。
// 下載的檔案存在 Transformers.js 自己的快取（transformers-cache），頁面上可以刪掉。
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { cleanOutput, messages } from "../tools/llm-bench/prompt.ts";
import { ASSETS_MODELS, type Part, assetsUrl, downloadVerified } from "../core/models.ts";

export interface BenchRequest {
  repo: string;
  revision: string;
  device: "webgpu" | "wasm";
  dtype: "q4f16" | "q4" | "q8";
  threads: number;
  texts: string[];
  // 社群轉檔的模型：assets.anoni.net 上的目錄、每個檔案的 SHA-256、切成好幾段的檔案
  assets?: { dir: string; files: Record<string, string>; parts: Record<string, Part[]> };
}

export type BenchReply =
  | { type: "download"; loaded: number; total: number }
  | { type: "loaded"; seconds: number }
  | { type: "progress"; index: number; tokens: number }
  | { type: "text"; index: number; firstToken: number; tokensPerSecond: number; total: number; tokens: number; output: string }
  | { type: "done" }
  | { type: "error"; message: string };

const post = (reply: BenchReply) => self.postMessage(reply);

// 下載進度自己算，不用 progress_callback：有它時 Transformers.js 會先對每個檔案多發一次完整的 GET
const files: Record<string, [number, number]> = {};
function report(key: string, loaded: number, total: number) {
  files[key] = [loaded, total];
  const sum = Object.values(files).reduce((a, [l, t]) => [a[0] + l, a[1] + t], [0, 0]);
  post({ type: "download", loaded: sum[0]!, total: sum[1]! });
}
function counted(response: Response, key: string): Response {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) return response;
  let loaded = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.length;
        report(key, loaded, total);
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// 社群轉檔的模型：只下載清單上的檔案，比對 SHA-256，切成好幾段的檔案逐段比對、接回來
// （src/core/models.ts）。存進 Transformers.js 自己的快取，不經過 gears-models
async function fromAssets(assets: NonNullable<BenchRequest["assets"]>, file: string): Promise<Response> {
  const sha256 = assets.files[file];
  // 清單外的檔案（Transformers.js 會試著讀一些選用的設定檔）當成不存在
  if (!sha256) return new Response(null, { status: 404 });
  const data = await downloadVerified({ url: (name) => assetsUrl(assets.dir, name), file, sha256, parts: assets.parts[file] }, (n, total) => report(file, n, total));
  return new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(data.length) } });
}

self.onmessage = async ({ data }: MessageEvent<BenchRequest>) => {
  try {
    const { TextStreamer, env, pipeline } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    // WebAssembly 的載入程式不存快取：存了之後改用 blob: 網址載入，CSP 的 script-src 不允許
    env.useWasmCache = false;
    // Transformers.js 有幾處讀檔沒有把 revision 傳下去，還是用 main，會被 CSP 擋下。
    // 一個 Worker 只載入一個模型，直接把下載路徑鎖在這個 commit
    env.remotePathTemplate = `{model}/resolve/${data.revision}/`;
    // 社群轉檔的模型以 assets.anoni.net 上的目錄當模型名稱
    const assets = data.assets;
    if (assets) {
      env.remoteHost = ASSETS_MODELS;
      env.remotePathTemplate = "{model}/";
    }
    const assetsDir = assets ? new URL(assetsUrl(assets.dir, ""), self.location.href).href : "";
    env.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const absolute = new URL(url, self.location.href).href;
      if (assets && absolute.startsWith(assetsDir)) return fromAssets(assets, absolute.slice(assetsDir.length).split("?")[0]!);
      // 不帶 cookie 與 Referer
      // 失敗時帶上網址，畫面上看得出是哪個檔案下載不了
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
    const generate = await pipeline("text-generation", data.repo, { revision: data.revision, device: data.device, dtype: data.dtype });
    post({ type: "loaded", seconds: (performance.now() - start) / 1000 });

    for (const [index, text] of data.texts.entries()) {
      let first = 0;
      let tokens = 0;
      const begin = performance.now();
      const streamer = new TextStreamer(generate.tokenizer, {
        skip_prompt: true,
        callback_function: () => {},
        token_callback_function: () => {
          tokens++;
          if (!first) first = performance.now();
          if (tokens % 10 === 1) post({ type: "progress", index, tokens });
        },
      });
      const out = (await generate(messages(text, data.repo), { max_new_tokens: 400, do_sample: false, streamer })) as unknown as {
        generated_text: { content: string }[];
      }[];
      const end = performance.now();
      post({
        type: "text",
        index,
        firstToken: ((first || end) - begin) / 1000,
        tokensPerSecond: tokens > 1 ? (tokens - 1) / ((end - first) / 1000) : 0,
        total: (end - begin) / 1000,
        tokens,
        output: cleanOutput(out[0]!.generated_text.at(-1)!.content),
      });
    }
    await generate.dispose();
    post({ type: "done" });
  } catch (error) {
    post({ type: "error", message: String((error as Error)?.message ?? error) });
  }
};

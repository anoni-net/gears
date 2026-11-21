// 從 assets.anoni.net 載入社群放好的 Transformers.js 模型（onion 版是同一個網站的 /models/assets/）：
// 個資辨識（pii-runtime.ts）與逐字稿的標點建議（punct.worker.ts）共用。只能在 Worker 裡匯入。
//
// Transformers.js 的設定照 llm-bench.worker.ts 的社群轉檔模型：只下載清單上的檔案、逐一比對 SHA-256，
// 模型目錄以外的請求一律不送，WebAssembly 用 ?url 從自己的網域載入。下載的檔案由 Transformers.js 存在
// transformers-cache，service worker 換版本時不會清掉（只清 gears- 開頭的快取）
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { ASSETS_MODELS, assetsUrl, downloadVerified } from "../core/models.ts";

type Env = (typeof import("@huggingface/transformers"))["env"];

export interface AssetsModel {
  dir: string;
  files: Record<string, string>;
}

export interface AssetsDownload {
  // 這次實際下載的位元組（已經在快取裡的檔案不會經過這裡）
  readonly downloaded: number;
  // 下載失敗的原因：Transformers.js 會把 env.fetch 的錯誤換成「找不到檔案」，畫面要分出是不是下載失敗時讀這個
  readonly error: Error | null;
}

// onDownload：讀到的位元組與清單上的總量（伺服器沒有標示大小的檔案算 0）
export function useAssetsModel(env: Env, model: AssetsModel, threads: number, onDownload?: (loaded: number, total: number) => void): AssetsDownload {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  // WebAssembly 的載入程式不存快取：存了之後改用 blob: 網址載入，CSP 的 script-src 不允許
  env.useWasmCache = false;
  // assets.anoni.net 上的目錄當模型名稱，目錄名稱帶著 commit，內容不會變
  env.remoteHost = ASSETS_MODELS;
  env.remotePathTemplate = "{model}/";

  const progress: Record<string, [number, number]> = {};
  const state = { downloaded: 0, error: null as Error | null };
  // 清單外的檔案（Transformers.js 會試著讀一些選用的設定檔）當成不存在。對不上 SHA-256 時丟出錯誤，不存進快取
  const fromAssets = async (file: string): Promise<Response> => {
    const sha256 = model.files[file];
    if (!sha256) return new Response(null, { status: 404 });
    let last = 0;
    const data = await downloadVerified({ url: (name) => assetsUrl(model.dir, name), file, sha256 }, (n, total) => {
      state.downloaded += n - last;
      last = n;
      progress[file] = [n, total];
      const sum = Object.values(progress).reduce((a, [l, t]) => [a[0]! + l, a[1]! + t], [0, 0]);
      onDownload?.(sum[0]!, sum[1]!);
    });
    return new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(data.length) } });
  };
  const dir = new URL(assetsUrl(model.dir, ""), self.location.href).href;
  env.fetch = (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), self.location.href).href;
    if (!url.startsWith(dir)) return Promise.resolve(new Response(null, { status: 404 }));
    return fromAssets(url.slice(dir.length).split("?")[0]!).catch((error: Error) => {
      state.error = new Error(`${error.message}（${url}）`);
      throw state.error;
    });
  };
  const wasm = env.backends.onnx.wasm!;
  const asyncify = JSON.stringify(wasm.wasmPaths ?? "").includes(".asyncify");
  wasm.wasmPaths = asyncify ? { mjs: asyncifyMjs, wasm: asyncifyWasm } : { mjs: plainMjs, wasm: plainWasm };
  wasm.numThreads = self.crossOriginIsolated ? threads : 1;
  return state;
}

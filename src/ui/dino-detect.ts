import { KEEP_CACHE, LLM_CACHE } from "../core/storage.ts";
import { assetsUrl } from "../core/models.ts";
import { DINO_MB, DINO_MODEL } from "../tools/verify/dino-model.ts";
import type { DinoReply, DinoRequest } from "./dino.worker.ts";
import workerUrl from "./dino.worker.ts?worker&url";
// Transformers.js 帶的那一份 onnxruntime（Worker 選 asyncify 版，見 assets-env.ts），用來判斷執行環境在不在 gears-keep
import runtimeWasmUrl from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";

// 查證的相似圖片第二層（src/ui/SimilarImages.tsx）：每張圖整張壓成 224 × 224 交給 DINOv2 small（Worker 是 dino.worker.ts），
// 取回特徵。模型約 24 MB，讀者按下按鈕才下載，存在 transformers-cache。
//
// 手機的記憶體不夠時，系統會把分頁重新載入，暫存區會清空。開始載入之前在 sessionStorage 記下，做完、失敗或取消時清掉。
// 打開查證時記號還在，代表上一次做到一半被重新載入，畫面說明原因，同一個分頁不再出現按鈕（照標點建議的 gears-punct）

const MARK = "gears-dino";

const mark = (on: boolean) => {
  try {
    if (on) sessionStorage.setItem(MARK, "1");
    else sessionStorage.removeItem(MARK);
  } catch {
    // 存不進去就算了
  }
};

// 上一次用 DINOv2 時頁面被重新載入了
export const dinoCrashedBefore = () => {
  try {
    return sessionStorage.getItem(MARK) === "1";
  } catch {
    return false;
  }
};

// Transformers.js 的 asyncify 版 WebAssembly（Worker 實際載入的那一份），沒有壓縮的大小 26.9 MB。沒用過逐字稿、個資辨識或標點建議的讀者第一次也要下載
const RUNTIME_MB = 27;

// 還要下載多少 MB：模型不在 transformers-cache 時算模型，執行環境不在 gears-keep 時加上執行環境。
// 不能用 Cache API 時（私密瀏覽、Tor Browser）每次都要下載，照第一次的大小寫
export async function dinoDownloadMb(): Promise<number> {
  try {
    if (typeof caches === "undefined") return DINO_MB + RUNTIME_MB;
    const model = new URL(assetsUrl(DINO_MODEL.dir, "onnx/model_int8.onnx"), location.href).href;
    const runtime = new URL(runtimeWasmUrl, location.href).href;
    const has = async (cache: string, url: string) => (await caches.has(cache)) && !!(await (await caches.open(cache)).match(url, { ignoreVary: true }));
    return ((await has(LLM_CACHE, model)) ? 0 : DINO_MB) + ((await has(KEEP_CACHE, runtime)) ? 0 : RUNTIME_MB);
  } catch {
    return DINO_MB + RUNTIME_MB;
  }
}

// 模型下載失敗（網路、檔案的內容對不上），畫面另外說明
export class DinoDownloadError extends Error {}
export const CANCELLED = "cancelled";

export type DinoProgress = { kind: "download"; loaded: number; total: number } | { kind: "loading" } | { kind: "run"; done: number; total: number };

let workers = 0;

export interface DinoRunner {
  run(images: Uint8ClampedArray[], onProgress: (p: DinoProgress) => void): Promise<Float32Array[]>;
  cancel(): void;
}

// 每一次開一個新的 Worker，算完就結束。Worker 的網址每次加不同的查詢字串：WebKit 第二次用同一個網址建立 Worker 時，
// 會被 Cross-Origin-Embedder-Policy 擋下（同逐字稿）
export function dinoRunner(): DinoRunner {
  let current: { worker: Worker; stop: (error: Error) => void } | null = null;
  // 沒有進行中的 Worker 時不動記號：上一次當機留下的記號要留著，同一個分頁才不會再出現按鈕
  const finish = () => {
    if (!current) return;
    current.worker.terminate();
    current = null;
    mark(false);
  };
  return {
    async run(images, onProgress) {
      finish();
      const worker = new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
      mark(true);
      try {
        return await new Promise<Float32Array[]>((resolve, reject) => {
          current = { worker, stop: reject };
          worker.onmessage = ({ data }: MessageEvent<DinoReply>) => {
            if (data.type === "download") onProgress({ kind: "download", loaded: Math.min(data.loaded, data.total), total: data.total });
            else if (data.type === "loaded") onProgress({ kind: "loading" });
            else if (data.type === "progress") onProgress({ kind: "run", done: data.done, total: data.total });
            else if (data.type === "result") resolve(data.features);
            else {
              // 只有錯誤訊息，不含圖片的內容，讀者回報問題時用得到
              console.warn("[gears] 相似圖片的模型失敗：", data.message);
              reject(data.remote ? new DinoDownloadError(data.message) : new Error(data.message));
            }
          };
          worker.onerror = (event) => reject(new Error(event.message || "worker"));
          // 交給 Worker 的是複本：同一批像素留在畫面這一側，失敗之後再按一次不必重新解碼
          worker.postMessage({ images: images.map((x) => x.slice()) } satisfies DinoRequest);
        });
      } finally {
        if (current?.worker === worker) finish();
      }
    },
    cancel() {
      const stop = current?.stop;
      finish();
      stop?.(new Error(CANCELLED));
    },
  };
}

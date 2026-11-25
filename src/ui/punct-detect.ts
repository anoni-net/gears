import { LLM_CACHE } from "../core/storage.ts";
import { assetsUrl } from "../core/models.ts";
import { type Insert, PUNCT_MODEL, cleanForModel, joinSegments, placeMarks } from "../tools/transcribe/punct.ts";
import type { PunctReply, PunctRequest } from "./punct.worker.ts";
import workerUrl from "./punct.worker.ts?worker&url";

// 逐字稿的標點建議（src/ui/TranscribeEditor.tsx）：整份逐字稿的段落接起來交給標點模型（Worker 是 punct.worker.ts），
// 結果分回各段。模型約 148 MB，第一次用到時下載，存在 transformers-cache。
//
// 手機的記憶體不夠時，系統會把分頁重新載入，轉好的逐字稿會不見。開始載入之前在 sessionStorage 記下，
// 做完、失敗或取消時清掉。打開逐字稿時記號還在，代表上一次做到一半被重新載入，畫面說明原因，同一個分頁
// 不再出現按鈕（照遮蔽的 gears-pii-redact，src/ui/pii-detect.ts）。sessionStorage 只在這個分頁裡，關掉分頁就清掉

const MARK = "gears-punct";

const mark = (on: boolean) => {
  try {
    if (on) sessionStorage.setItem(MARK, "1");
    else sessionStorage.removeItem(MARK);
  } catch {
    // 存不進去就算了
  }
};

// 上一次用標點模型時頁面被重新載入了
export const punctCrashedBefore = () => {
  try {
    return sessionStorage.getItem(MARK) === "1";
  } catch {
    return false;
  }
};

// 模型已經在快取裡，不必再寫下載量
export async function punctStored(): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !(await caches.has(LLM_CACHE))) return false;
    const url = new URL(assetsUrl(PUNCT_MODEL.dir, "onnx/model_quantized.onnx"), location.href).href;
    return !!(await (await caches.open(LLM_CACHE)).match(url));
  } catch {
    return false;
  }
}

// 模型下載失敗（網路、檔案的內容對不上），畫面另外說明
export class PunctDownloadError extends Error {}
export const CANCELLED = "cancelled";

export type PunctProgress = { kind: "download"; loaded: number; total: number } | { kind: "loading" } | { kind: "run"; done: number; total: number };

let workers = 0;

export interface PunctRunner {
  // texts 是每一段的文字，回傳每一段要插入的標點
  run(texts: string[], onProgress: (p: PunctProgress) => void): Promise<Insert[][]>;
  // 停下進行中的那一次（Worker 直接結束），run 以 CANCELLED 失敗
  cancel(): void;
}

// 一個逐字稿畫面一個。每一次開一個新的 Worker，算完就結束，不留著佔記憶體。Worker 的網址每次加不同的查詢字串：
// WebKit 第二次用同一個網址建立 Worker 時，會被 Cross-Origin-Embedder-Policy 擋下（同逐字稿）
export function punctRunner(): PunctRunner {
  let current: { worker: Worker; stop: (error: Error) => void } | null = null;
  // 沒有進行中的 Worker 時不動記號：上一次當機留下的記號要留著，關掉再打開逐字稿、重新轉一次之後
  // 才不會又出現按鈕（同 dino-detect.ts）
  const finish = () => {
    if (!current) return;
    current.worker.terminate();
    current = null;
    mark(false);
  };
  return {
    async run(texts, onProgress) {
      const { clean } = cleanForModel(joinSegments(texts).text);
      if (!clean.trim()) return texts.map(() => []);
      finish();
      const worker = new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
      mark(true);
      try {
        const predictions = await new Promise<(PunctReply & { type: "result" })["predictions"]>((resolve, reject) => {
          current = { worker, stop: reject };
          worker.onmessage = ({ data }: MessageEvent<PunctReply>) => {
            if (data.type === "download") onProgress({ kind: "download", loaded: Math.min(data.loaded, data.total), total: data.total });
            else if (data.type === "loaded") onProgress({ kind: "loading" });
            else if (data.type === "progress") onProgress({ kind: "run", done: data.done, total: data.total });
            else if (data.type === "result") resolve(data.predictions);
            else {
              // 只有錯誤訊息，不含逐字稿的內容，讀者回報問題時用得到
              console.warn("[gears] 標點建議失敗：", data.message);
              reject(data.remote ? new PunctDownloadError(data.message) : new Error(data.message));
            }
          };
          worker.onerror = (event) => reject(new Error(event.message || "worker"));
          worker.postMessage({ text: clean } satisfies PunctRequest);
        });
        return placeMarks(texts, predictions);
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

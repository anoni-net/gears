import { LLM_CACHE } from "../core/storage.ts";
import { assetsUrl } from "../core/models.ts";
import type { Box } from "../tools/redact/index.ts";
import { type LineText, pad } from "../tools/redact/pii.ts";
import { type ModelMatch, PII_MODEL, chunkLines, joinLines, spanBoxes } from "../tools/redact/pii-model.ts";
import type { PiiReply, PiiRequest } from "./pii.worker.ts";
import workerUrl from "./pii.worker.ts?worker&url";

// 遮蔽的「用開源本機模型找人名、地址與單位」（#187）：文字辨識讀出的每一行交給個資辨識模型（Worker 是 pii.worker.ts），
// 找到的範圍換回圖片上的框。模型約 200 MB，第一次用到時下載，存在 transformers-cache，量測頁用同一份。
//
// 手機的記憶體不夠時，系統會把分頁重新載入，暫存區與畫到一半的框都會不見。開始之前在 sessionStorage 記下，
// 做完、失敗或取消時清掉。打開遮蔽時記號還在，代表上一次做到一半被重新載入，畫面說明原因，同一個分頁
// 不再出現按鈕。不用量測頁的 history.state：它是每一筆歷史紀錄各一份，回到桌面再點進遮蔽就讀不到。
// sessionStorage 只在這個分頁裡，關掉分頁就清掉，不寫進 localStorage。私密瀏覽存不進去時照樣可以用，只是記不住

const MARK = "gears-pii-redact";

const mark = (on: boolean) => {
  try {
    if (on) sessionStorage.setItem(MARK, "1");
    else sessionStorage.removeItem(MARK);
  } catch {
    // 存不進去就算了
  }
};

// 上一次用模型時頁面被重新載入了
export const crashedBefore = () => {
  try {
    return sessionStorage.getItem(MARK) === "1";
  } catch {
    return false;
  }
};

// 手機與平板：模型在這類裝置上還沒有實測的數字（協助測試頁收集中），按下按鈕時先多一步確認
// （src/ui/RedactEditor.tsx）。iPadOS 的 Safari 回報的是 Mac，靠觸控點數分出來
export function onPhone(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (data?.mobile) return true;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// 模型已經在快取裡（量測頁或上一次遮蔽下載過），不必再寫下載量
export async function piiStored(): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !(await caches.has(LLM_CACHE))) return false;
    const url = new URL(assetsUrl(PII_MODEL.dir, `onnx/model_${PII_MODEL.dtype}.onnx_data`), location.href).href;
    return !!(await (await caches.open(LLM_CACHE)).match(url));
  } catch {
    return false;
  }
}

let workers = 0;

export interface PiiDetector {
  // lines 是文字辨識讀出的每一行（字與字框），width、height 是圖片的大小。
  // onProgress：下載時是 0 到 1，載入與辨識時是 null
  find(lines: LineText[], width: number, height: number, onProgress?: (p: number | null) => void): Promise<ModelMatch[]>;
  dispose(): void;
}

// 一個編輯畫面一個，關掉時 dispose。Worker 的網址每次加不同的查詢字串：WebKit 第二次用同一個網址建立 Worker 時，
// 會被 Cross-Origin-Embedder-Policy 擋下（同逐字稿）
export function piiDetector(): PiiDetector {
  let worker: Worker | null = null;
  // 進行中的那一次，關掉編輯畫面時讓它結束，記號跟著清掉（不然下次打開會被當成記憶體不夠）
  let stop: ((error: Error) => void) | null = null;
  return {
    async find(lines, width, height, onProgress) {
      // 沒有讀到文字就不必下載模型
      if (!lines.some((line) => line.text.trim())) return [];
      worker ??= new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
      const chunks = chunkLines(lines).map((chunk) => ({ chunk, ...joinLines(chunk) }));
      mark(true);
      try {
        const spans = await new Promise<PiiReply & { type: "result" }>((resolve, reject) => {
          stop = reject;
          worker!.onmessage = ({ data }: MessageEvent<PiiReply>) => {
            // 經過壓縮的檔案收到的位元組可能比標示的大小多，進度夾在 1 以內
            if (data.type === "download") onProgress?.(data.total ? Math.min(1, data.loaded / data.total) : null);
            else if (data.type === "loaded") onProgress?.(null);
            else if (data.type === "result") resolve(data);
            else reject(new Error(data.message));
          };
          worker!.onerror = (event) => reject(new Error(event.message || "worker"));
          worker!.postMessage({ texts: chunks.map((c) => c.text) } satisfies PiiRequest);
        });
        return chunks.flatMap(({ chunk, at }, i) =>
          spanBoxes(chunk, at, spans.spans[i] ?? []).map((m) => ({ ...m, box: pad(m.box, 0.15, width, height) as Box })),
        );
      } finally {
        stop = null;
        mark(false);
      }
    },
    dispose() {
      worker?.terminate();
      worker = null;
      stop?.(new Error("disposed"));
      mark(false);
    },
  };
}

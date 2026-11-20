import { KEEP_CACHE, OCR_MB, RUNTIME_MB, redactDownload } from "../core/storage.ts";
// 遮蔽用的那一份 onnxruntime 的 WebAssembly，用來判斷執行環境在不在 gears-keep（Transformers.js 另帶一份檔名相近的）
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";

export interface DetectDownload {
  faces: number; // 找人臉還要下載多少 MB
  text: number; // 辨識文字還要下載多少 MB
  stored: boolean; // 下載的會存在 gears-keep，下次不必再下載
}

// 讀 gears-keep 看找人臉與辨識文字還要下載多少，遮蔽的自動尋找與檔案畫面的檢查畫面內容共用。
// 不能用 Cache API 時（私密瀏覽、Tor Browser）存不下來，每次都照第一次的大小寫
export async function detectDownload(): Promise<DetectDownload> {
  const always = { faces: RUNTIME_MB, text: RUNTIME_MB + OCR_MB, stored: false };
  try {
    if (typeof caches === "undefined") return always;
    if (!(await caches.has(KEEP_CACHE))) return { ...always, stored: true };
    const requests = await (await caches.open(KEEP_CACHE)).keys();
    return { ...redactDownload(requests.map((r) => r.url), import.meta.env.BASE_URL, ortWasmUrl), stored: true };
  } catch {
    return always;
  }
}

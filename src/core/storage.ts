import whisper from "../tools/transcribe/models.json" with { type: "json" };
import { PII_MODEL } from "../tools/redact/pii-model.ts";
import { PUNCT_MODEL } from "../tools/transcribe/punct.ts";
import { DINO_MODEL } from "../tools/verify/dino-model.ts";
import ppocr from "../tools/redact/ppocr-models.json" with { type: "json" };
import { MODEL_CACHE } from "./models.ts";

// 已下載的模型（src/ui/StoragePage.tsx）：Gears 存在這個瀏覽器裡的模型與程式，依用途分成一列一列，
// 讀者看得到各占多少空間、可以刪除（#142）。工作台本身的頁面與程式（gears-<版本>）是離線使用
// 要用的，不列進來。
//
// 三個快取：
// - gears-models：逐字稿的模型（src/core/models.ts、service worker 的 MODEL_DIRS）
// - gears-keep：用到時才存的辨識模型與 WebAssembly（service worker 的 LAZY）
// - transformers-cache：Transformers.js 自己存的模型：裝置量測的語言模型，以及遮蔽與量測頁共用的個資辨識模型
//   （src/ui/pii-runtime.ts）、逐字稿的標點建議（src/ui/punct.worker.ts）與查證比對相近圖片的 DINOv2（src/ui/dino.worker.ts），
//   這三個各自列成一列，刪語言模型時不會一起刪掉

export const KEEP_CACHE = "gears-keep";
export const LLM_CACHE = "transformers-cache";
export const STORAGE_CACHES = [MODEL_CACHE, KEEP_CACHE, LLM_CACHE];

export type StorageGroup = "transcribe" | "speaker" | "vad" | "punct" | "faces" | "ocr" | "pii" | "dino" | "runtime" | "pdf" | "c2pa" | "llm" | "other";

// 畫面上的順序
export const STORAGE_GROUPS: readonly StorageGroup[] = ["transcribe", "speaker", "vad", "punct", "faces", "ocr", "pii", "dino", "runtime", "pdf", "c2pa", "llm", "other"];

export interface StorageKey {
  group: StorageGroup;
  model?: string; // 逐字稿的模型 id（src/tools/transcribe/models.json）
}

const MODEL_IDS = Object.keys(whisper);
const byDir = new Map(Object.entries(whisper).map(([id, m]) => [m.dir, id]));

// 快取裡的一個網址屬於哪一列。base 是工作台的路徑（/gears/，onion 版是 /）
export function classify(cache: string, url: string, base: string): StorageKey {
  if (cache === LLM_CACHE) {
    const path = new URL(url, "http://x").pathname;
    return { group: path.includes(`/${PII_MODEL.dir}/`) ? "pii" : path.includes(`/${PUNCT_MODEL.dir}/`) ? "punct" : path.includes(`/${DINO_MODEL.dir}/`) ? "dino" : "llm" };
  }
  const path = new URL(url, "http://x").pathname;
  if (!path.startsWith(base)) return { group: "other" };
  const rest = path.slice(base.length);
  const whisperDir = /^models\/whisper\/([^/]+)\//.exec(rest)?.[1];
  if (whisperDir) {
    const model = byDir.get(whisperDir);
    return model ? { group: "transcribe", model } : { group: "other" };
  }
  if (rest.startsWith("models/speaker/")) return { group: "speaker" };
  // 逐字稿的語音偵測（Silero VAD，存在 gears-keep）另外一列：每次轉逐字稿都會用到，跟勾選才下載的
  // 分辨說話者不同，也不屬於某一個逐字稿的模型，刪掉某個模型時不會一起刪掉
  if (rest.startsWith("models/vad/")) return { group: "vad" };
  if (rest.startsWith("models/yunet")) return { group: "faces" };
  // 裝置量測的範例截圖（src/tools/bench/ocr.ts）跟辨識模型放在同一列
  if (rest.startsWith("models/ppocr/") || rest.startsWith("models/bench/ocr-")) return { group: "ocr" };
  if (rest.startsWith("vendor/pdfjs/")) return { group: "pdf" };
  if (rest.startsWith("vendor/sherpa/") || rest.startsWith("assets/ort-wasm-")) return { group: "runtime" };
  if (rest.startsWith("assets/c2pa_bg-")) return { group: "c2pa" };
  return { group: "other" };
}

// 執行模型的程式、pdf.js 的資料與驗證內容憑證的程式不是模型，設計原則頁的即時檢查只列模型（src/ui/AboutPage.tsx）
export const MODEL_GROUPS: readonly StorageGroup[] = ["transcribe", "speaker", "vad", "punct", "faces", "ocr", "pii", "dino", "llm"];

export const keyId = (key: StorageKey) => (key.model ? `${key.group}:${key.model}` : key.group);

// 依畫面上的順序排，逐字稿的模型照 models.json 的順序
export function compareKeys(a: StorageKey, b: StorageKey): number {
  const group = STORAGE_GROUPS.indexOf(a.group) - STORAGE_GROUPS.indexOf(b.group);
  return group || MODEL_IDS.indexOf(a.model ?? "") - MODEL_IDS.indexOf(b.model ?? "");
}

// 遮蔽的自動尋找第一次使用要下載多少（src/ui/RedactEditor.tsx），按下按鈕之前就寫在畫面上，
// 用行動網路的讀者先知道。onnxruntime 的 WebAssembly 兩者共用，約 14 MB（伺服器有壓縮時約 4 MB），
// 人臉的模型約 0.2 MB 不計，文字辨識的兩個模型約 26 MB（PP-OCRv5 mobile 的偵測加 PP-OCRv6 small 的辨識）。
// paths 是 gears-keep 裡的網址，service worker 換版本時已經清掉雜湊對不上的，留下的都能直接用。
// runtime 是遮蔽用的那一份 WebAssembly 的網址。Transformers.js 另帶一份 onnxruntime（檔名開頭相同、
// 雜湊不同），用過逐字稿不代表遮蔽的執行環境已經在。數字照沒有壓縮的大小，寧可多寫
export const RUNTIME_MB = 14;
// 文字辨識的兩個模型，從 ppocr-models.json 的大小算出（設計原則頁的模型表也用這一份）
export const OCR_MB = Math.round((ppocr.det.bytes + ppocr.rec.bytes) / 1e6);

export function redactDownload(paths: readonly string[], base: string, runtimeUrl: string): { faces: number; text: number } {
  const rest = paths.map((url) => {
    const path = new URL(url, "http://x").pathname;
    return path.startsWith(base) ? path.slice(base.length) : "";
  });
  const want = new URL(runtimeUrl, "http://x").pathname;
  const runtime = want.startsWith(base) && rest.includes(want.slice(base.length));
  // 比對清單上現在的檔名：換過模型時，快取裡可能還有舊版的檔案（service worker 換版本時才清掉）
  const ocr = [ppocr.det.name, ppocr.rec.name].every((name) => rest.includes(`models/ppocr/${name}`));
  return { faces: runtime ? 0 : RUNTIME_MB, text: (ocr ? 0 : OCR_MB) + (runtime ? 0 : RUNTIME_MB) };
}

// 超過 1 GB 的寫成 1.6 GB，1 MB 以下的寫成 KB。已下載的模型與設計原則頁的模型表共用
export const formatSize = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

export interface StorageRow {
  key: StorageKey;
  bytes: number;
  entries: [cache: string, request: Request][];
}

// 讀三個快取，依用途分列。已下載的模型（src/ui/StoragePage.tsx）與設計原則頁的即時檢查（src/ui/AboutPage.tsx）共用。
// 不能用 Cache API 時（私密瀏覽、Tor Browser）回傳 null。base 是工作台的路徑（/gears/，onion 版是 /）
export async function scanStorage(base: string): Promise<StorageRow[] | null> {
  if (typeof caches === "undefined") return null;
  const names = await caches.keys().catch(() => null);
  if (!names) return null;
  const rows = new Map<string, StorageRow>();
  for (const name of STORAGE_CACHES) {
    if (!names.includes(name)) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const key = classify(name, request.url, base);
      // 快取的內容存在磁碟上，blob() 不會把整個檔案讀進記憶體
      const bytes = (await (await cache.match(request))?.blob())?.size ?? 0;
      const row = rows.get(keyId(key)) ?? { key, bytes: 0, entries: [] };
      row.bytes += bytes;
      row.entries.push([name, request]);
      rows.set(keyId(key), row);
    }
  }
  return [...rows.values()].sort((a, b) => compareKeys(a.key, b.key));
}

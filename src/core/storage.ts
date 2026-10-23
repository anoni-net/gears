import whisper from "../tools/transcribe/models.json" with { type: "json" };
import { MODEL_CACHE } from "./models.ts";

// 已下載的模型（src/ui/StoragePage.tsx）：Gears 存在這個瀏覽器裡的模型與程式，依用途分成一列一列，
// 讀者看得到各占多少空間、可以刪除（#142）。工作台本身的頁面與程式（gears-<版本>）是離線使用
// 要用的，不列進來。
//
// 三個快取：
// - gears-models：逐字稿的模型（src/core/models.ts、service worker 的 MODEL_DIRS）
// - gears-keep：用到時才存的辨識模型與 WebAssembly（service worker 的 LAZY）
// - transformers-cache：裝置量測的語言模型，由 Transformers.js 自己存

export const KEEP_CACHE = "gears-keep";
export const LLM_CACHE = "transformers-cache";
export const STORAGE_CACHES = [MODEL_CACHE, KEEP_CACHE, LLM_CACHE];

export type StorageGroup = "transcribe" | "speaker" | "faces" | "ocr" | "runtime" | "pdf" | "c2pa" | "llm" | "other";

// 畫面上的順序
export const STORAGE_GROUPS: readonly StorageGroup[] = ["transcribe", "speaker", "faces", "ocr", "runtime", "pdf", "c2pa", "llm", "other"];

export interface StorageKey {
  group: StorageGroup;
  model?: string; // 逐字稿的模型 id（src/tools/transcribe/models.json）
}

const MODEL_IDS = Object.keys(whisper);
const byDir = new Map(Object.entries(whisper).map(([id, m]) => [m.dir, id]));

// 快取裡的一個網址屬於哪一列。base 是工作台的路徑（/gears/，onion 版是 /）
export function classify(cache: string, url: string, base: string): StorageKey {
  if (cache === LLM_CACHE) return { group: "llm" };
  const path = new URL(url, "http://x").pathname;
  if (!path.startsWith(base)) return { group: "other" };
  const rest = path.slice(base.length);
  const whisperDir = /^models\/whisper\/([^/]+)\//.exec(rest)?.[1];
  if (whisperDir) {
    const model = byDir.get(whisperDir);
    return model ? { group: "transcribe", model } : { group: "other" };
  }
  if (rest.startsWith("models/speaker/")) return { group: "speaker" };
  if (rest.startsWith("models/yunet")) return { group: "faces" };
  // 裝置量測的範例截圖（src/tools/bench/ocr.ts）跟辨識模型放在同一列
  if (rest.startsWith("models/ppocr/") || rest.startsWith("models/bench/ocr-")) return { group: "ocr" };
  if (rest.startsWith("vendor/pdfjs/")) return { group: "pdf" };
  if (rest.startsWith("vendor/sherpa/") || rest.startsWith("assets/ort-wasm-")) return { group: "runtime" };
  if (rest.startsWith("assets/c2pa_bg-")) return { group: "c2pa" };
  return { group: "other" };
}

export const keyId = (key: StorageKey) => (key.model ? `${key.group}:${key.model}` : key.group);

// 依畫面上的順序排，逐字稿的模型照 models.json 的順序
export function compareKeys(a: StorageKey, b: StorageKey): number {
  const group = STORAGE_GROUPS.indexOf(a.group) - STORAGE_GROUPS.indexOf(b.group);
  return group || MODEL_IDS.indexOf(a.model ?? "") - MODEL_IDS.indexOf(b.model ?? "");
}

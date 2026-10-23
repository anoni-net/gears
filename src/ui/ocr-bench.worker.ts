// 裝置量測的文字辨識（src/ui/OcrBench.tsx）的 Worker：用遮蔽同一份 PP-OCRv5（src/ui/ppocr.ts）辨識
// 三張範例截圖，回報載入時間、每張的偵測與辨識時間，以及辨識出的文字。
//
// onnxruntime 第一次建立推論環境時就決定了執行緒數，頁面每量一種設定就換一個 Worker。
// 模型與 WebAssembly 跟遮蔽一樣從自己的網域載入，圖片也是，不讀暫存區的檔案。
import { type OcrTiming, loadPpocr } from "./ppocr.ts";

export interface OcrBenchRequest {
  base: string;
  threads: number;
  webgpu: boolean;
  repeat: number;
  samples: { id: string; url: string }[];
}

export type OcrBenchReply =
  | { type: "loaded"; ms: number; isolated: boolean }
  | { type: "sample"; id: string; round: number; det: number; rec: number; total: number; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const post = (reply: OcrBenchReply) => self.postMessage(reply);

self.onmessage = async ({ data }: MessageEvent<OcrBenchRequest>) => {
  try {
    const started = performance.now();
    const ocr = await loadPpocr(data.base, { threads: data.threads, webgpu: data.webgpu });
    post({ type: "loaded", ms: performance.now() - started, isolated: self.crossOriginIsolated });
    try {
      for (const sample of data.samples) {
        const response = await fetch(sample.url);
        if (!response.ok) throw new Error(`${sample.id}: ${response.status}`);
        const bitmap = await createImageBitmap(await response.blob());
        try {
          for (let round = 0; round < data.repeat; round++) {
            const timing: OcrTiming = { det: 0, rec: 0 };
            const begin = performance.now();
            const lines = await ocr.recognize(bitmap, undefined, timing);
            const total = performance.now() - begin;
            post({ type: "sample", id: sample.id, round, ...timing, total, text: lines.map((l) => l.text).join("\n") });
          }
        } finally {
          bitmap.close();
        }
      }
    } finally {
      await ocr.release();
    }
    post({ type: "done" });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};

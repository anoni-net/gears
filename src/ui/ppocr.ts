import { type OcrLine, cropFrame, cropTransform, ctcDecode, dbBoxes, detSize, recWidth } from "../tools/redact/ppocr.ts";
import models from "../tools/redact/ppocr-models.json" with { type: "json" };

// PP-OCRv5 mobile 的文字辨識：偵測模型找出文字行，辨識模型讀出每一行的字（純邏輯在
// src/tools/redact/ppocr.ts）。用 onnxruntime-web 的單執行緒 WebAssembly 執行，跟找人臉同一份，
// 模型從自己的網域載入（scripts/fetch-whisper.mjs 下載到 public/models/ppocr/），約 21 MB。
// 影像先畫到 canvas 上取像素，讀不到 canvas 的瀏覽器由呼叫的人先檢查（assertCanvasReadable）

export interface Ppocr {
  recognize(source: ImageBitmap, onProgress?: (progress: number) => void): Promise<OcrLine[]>;
  release(): Promise<void>;
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function loadPpocr(base: string): Promise<Ppocr> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  // PaddleOCR 轉出來的 ONNX 檔有一些沒用到的初始值，onnxruntime 載入時每一個都印一行警告到主控台。
  // 只印錯誤（logSeverityLevel 3）
  const options = { executionProviders: ["wasm"], logSeverityLevel: 3 as const };
  const [det, rec, dict] = await Promise.all([
    ort.InferenceSession.create(`${base}models/ppocr/${models.det.name}`, options),
    ort.InferenceSession.create(`${base}models/ppocr/${models.rec.name}`, options),
    // 18,383 字的字典取自辨識模型的 inference.yml（scripts/make-ppocr-dict.py），用到時才載入
    import("../tools/redact/ppocr-dict.json").then((m) => m.default as string[]),
  ]);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // draw 把圖畫到 w × h 的畫布上，取出像素排成 BGR、NCHW（PaddleOCR 讀進來是 BGR，
  // 平均值與標準差照順序套在 B、G、R 上）。padded：右邊補 0 到這個寬度（辨識用）
  function tensor(draw: (c: CanvasRenderingContext2D) => void, w: number, h: number, mean: number[], std: number[], padded = w) {
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingQuality = "high";
    draw(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const plane = padded * h;
    const out = new Float32Array(3 * plane);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = y * padded + x;
        out[o] = (px[i * 4 + 2]! / 255 - mean[0]!) / std[0]!;
        out[plane + o] = (px[i * 4 + 1]! / 255 - mean[1]!) / std[1]!;
        out[2 * plane + o] = (px[i * 4]! / 255 - mean[2]!) / std[2]!;
      }
    return new ort.Tensor("float32", out, [1, 3, h, padded]);
  }

  return {
    async recognize(source, onProgress) {
      const size = detSize(source.width, source.height);
      const input = tensor((c) => c.drawImage(source, 0, 0, size.w, size.h), size.w, size.h, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]);
      const detOut = await det.run({ [det.inputNames[0]!]: input });
      const map = detOut[det.outputNames[0]!]!;
      const prob = (await map.getData()) as Float32Array;
      const boxes = dbBoxes(prob, size.w, size.h, source.width / size.w, source.height / size.h);
      map.dispose();
      const lines: OcrLine[] = [];
      for (const [i, { quad, box, score }] of boxes.entries()) {
        onProgress?.((i + 1) / (boxes.length + 1));
        // 一行一行辨識，中間讓出主執行緒，進度條才會動
        if (i % 4 === 0) await nextFrame();
        const frame = cropFrame(quad);
        if (frame.w < 2 || frame.h < 2) continue;
        const width = recWidth(frame.w, frame.h);
        const m = cropTransform(frame, width.width, 48);
        const t = tensor(
          (c) => {
            c.setTransform(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!);
            c.drawImage(source, 0, 0);
          },
          width.width,
          48,
          [0.5, 0.5, 0.5],
          [0.5, 0.5, 0.5],
          width.padded,
        );
        const out = (await rec.run({ [rec.inputNames[0]!]: t }))[rec.outputNames[0]!]!;
        const [, T, C] = out.dims as number[];
        const r = ctcDecode((await out.getData()) as Float32Array, T!, C!, dict, frame, width.width, width.padded);
        out.dispose();
        if (r.text.trim()) lines.push({ text: r.text, score: r.score, detScore: score, box, quad, chars: r.chars });
      }
      onProgress?.(1);
      return lines;
    },
    async release() {
      await Promise.all([det.release(), rec.release()]);
    },
  };
}

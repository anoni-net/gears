import type { Box } from "../tools/redact/index.ts";
import { type Detection, type FaceSelection, MAYBE_SCORE, type Outputs, SCALES, decodeYunet, inputSize, selectFaces, toImage } from "../tools/redact/faces.ts";
import { findPiiInLines, lineBoxes, textLayerQuality, textLines } from "../tools/redact/pdf-text.ts";
import { type PiiMatch, type Word, findPii, overlaps, pad } from "../tools/redact/pii.ts";
import { type OcrWord, textSpans } from "../tools/redact/text-lines.ts";
import { assertCanvasReadable } from "./canvas-access.ts";
import type { PdfPages } from "./pdf-pages.ts";

// 遮蔽的自動尋找：人臉用 OpenCV 的 YuNet 模型（onnxruntime-web 執行），文字用 Tesseract
// 辨識之後找出個資，PDF 有文字層時直接讀文字層（findPdfText）。兩者都在瀏覽器裡執行，圖片不離開裝置。模型、WebAssembly 與語言資料
// 都從自己的網域載入，按下按鈕時才下載。
//
// 自動尋找一定會漏，畫面上把找到的框起來讓讀者逐一確認，不直接套用。

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;

// 網址帶 ?debug-faces 時，在主控台印出版本與每個候選的分數，讀者回報漏判、誤判時用。
// 只有數字與座標，不含圖片的內容
const DEBUG = new URLSearchParams(location.search).has("debug-faces");

// 進度：0 到 1，null 表示還在下載或載入模型，不知道要多久
export type OnProgress = (progress: number | null) => void;

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function canvasOf(bitmap: ImageBitmap, x = 0, y = 0, w = bitmap.width, h = bitmap.height): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return canvas;
}

// 縮小到指定尺寸。每次最多縮一半、開高品質的平滑，原始解析度的照片一口氣縮小很多倍時，
// 細節與相機雜訊會變成鋸齒，偵測的分數會掉
function shrink(bitmap: ImageBitmap, width: number, height: number): HTMLCanvasElement | ImageBitmap {
  let source: HTMLCanvasElement | ImageBitmap = bitmap;
  let [w, h] = [bitmap.width, bitmap.height];
  while (w > width * 2 || h > height * 2) {
    const next = document.createElement("canvas");
    next.width = Math.max(width, Math.round(w / 2));
    next.height = Math.max(height, Math.round(h / 2));
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, next.width, next.height);
    [source, w, h] = [next, next.width, next.height];
  }
  return source;
}

// --- 人臉 ---

export async function findFaces(bitmap: ImageBitmap, onProgress?: OnProgress): Promise<FaceSelection> {
  onProgress?.(null);
  const ort = await import("onnxruntime-web/wasm");
  // 只用單執行緒的 WebAssembly：多執行緒要伺服器另外送 cross-origin isolation 的標頭。
  // WebAssembly 檔由 Vite 打包到 assets/（檔名帶雜湊），離線快取用到時才存（vite.config.ts）
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(`${BASE}models/yunet-2023mar-dynamic.onnx`, { executionProviders: ["wasm"] });
  try {
    const found: Detection[] = [];
    for (const [i, long] of SCALES.entries()) {
      onProgress?.(i / SCALES.length);
      await nextFrame();
      const size = inputSize(bitmap.width, bitmap.height, long);
      // 模型要 BGR、0 到 255、NCHW。補到 32 倍數的部分維持黑色
      const canvas = document.createElement("canvas");
      canvas.width = size.padWidth;
      canvas.height = size.padHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(shrink(bitmap, size.width, size.height), 0, 0, size.width, size.height);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const plane = canvas.width * canvas.height;
      const input = new Float32Array(plane * 3);
      for (let p = 0; p < plane; p++) {
        input[p] = rgba[p * 4 + 2]!;
        input[plane + p] = rgba[p * 4 + 1]!;
        input[plane * 2 + p] = rgba[p * 4]!;
      }
      const outputs = await session.run({ input: new ort.Tensor("float32", input, [1, 3, canvas.height, canvas.width]) });
      for (const d of decodeYunet(outputs as unknown as Outputs, canvas.width, canvas.height, MAYBE_SCORE)) {
        found.push({ ...toImage(d, size.scale), scale: long });
      }
    }
    const { faces, maybe } = selectFaces(found);
    if (DEBUG) logFaces(bitmap, found, faces, maybe);
    onProgress?.(1);
    // YuNet 的框已經包到額頭與髮際，往外留一點就好
    const padded = (box: Box) => pad(box, 0.1, bitmap.width, bitmap.height);
    return { faces: faces.map(padded), maybe: maybe.map(padded) };
  } finally {
    await session.release();
  }
}

function logFaces(bitmap: ImageBitmap, found: Detection[], faces: Box[], maybe: Box[]) {
  const r = (n: number) => Math.round(n);
  const f = (n: number) => n.toFixed(2);
  const kept = (b: Box) => faces.includes(b);
  const possible = (b: Box) => maybe.includes(b);
  // 純文字一行一筆，讀者整段複製貼上就能回報
  const rows = [...found]
    .sort((a, b) => b.score - a.score)
    .map((d) => [d.scale ?? "", f(d.score), r(d.box.x), r(d.box.y), r(d.box.w), kept(d.box) ? "採用" : possible(d.box) ? "可能" : ""].join("\t"));
  console.info(
    [`[gears] ${__GEARS_COMMIT__} 找人臉 ${bitmap.width}×${bitmap.height}，${found.length} 次偵測，採用 ${faces.length} 個，可能 ${maybe.length} 個`, "長邊\tscore\tx\ty\tw\t結果", ...rows].join("\n"),
  );
}

// --- 文字 ---

export interface TextResult {
  pii: PiiMatch[];
  lines: Box[]; // 每一行文字的範圍，讀者想把文字全部框起來時用
}

// regions 只辨識圖片上的這幾塊（PDF 頁面上的圖片），沒有時整張辨識
export async function findText(bitmap: ImageBitmap, onProgress?: OnProgress, regions?: Box[]): Promise<TextResult> {
  onProgress?.(null);
  const areas = regions ?? [{ x: 0, y: 0, w: bitmap.width, h: bitmap.height }];
  let area = 0;
  const Tesseract = (await import("./tesseract.ts")).default;
  const worker = await Tesseract.createWorker(["chi_tra", "eng"], Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${BASE}vendor/tesseract/worker.min.js`,
    corePath: `${BASE}vendor/tesseract/`,
    langPath: `${BASE}vendor/tessdata`,
    workerBlobURL: false,
    // 語言資料不寫進 IndexedDB，瀏覽器的 HTTP 快取已經夠用
    cacheMethod: "none",
    // 下載與載入語言資料時不知道要多久，辨識時才有進度
    // 好幾塊時，進度依序分給每一塊
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status === "recognizing text" ? (area + m.progress) / areas.length : null),
  });
  try {
    const lines: Word[][] = [];
    const ocr: OcrWord[][] = [];
    for (const [i, r] of areas.entries()) {
      area = i;
      const x = Math.round(r.x);
      const y = Math.round(r.y);
      const { data } = await worker.recognize(canvasOf(bitmap, x, y, Math.round(r.w), Math.round(r.h)), {}, { blocks: true });
      // 切出來的那一塊從 (0,0) 算起，換回整張圖的座標
      const toBox = (b: { x0: number; y0: number; x1: number; y1: number }): Box => ({ x: b.x0 + x, y: b.y0 + y, w: b.x1 - b.x0, h: b.y1 - b.y0 });
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            ocr.push(line.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text, confidence: w.confidence, box: toBox(w.bbox) })));
            const words = line.words.filter((w) => w.text.trim() && w.confidence > 30);
            if (words.length) lines.push(words.map((w) => ({ text: w.text, box: toBox(w.bbox) })));
          }
        }
      }
    }
    const pii = findPii(lines).map((m) => ({ ...m, box: pad(m.box, 0.15, bitmap.width, bitmap.height) }));
    return { pii, lines: textSpans(ocr).map((box) => pad(box, 0.1, bitmap.width, bitmap.height)) };
  } finally {
    await worker.terminate();
  }
}

// PDF 的一頁：有可靠的文字層時直接讀，不必下載 Tesseract，也不會認錯字。沒有文字層（掃描檔）
// 或讀出來是亂碼時整頁辨識。頁面上有圖片時，圖片裡的字不在文字層，另外辨識那幾塊，
// 跟文字層重疊的框只留一個。
//
// 瀏覽器關掉 WebAssembly 時（ocr 是 false）只讀文字層：需要整頁辨識時丟出 NoOcrError，
// 圖片裡的字略過。只讀文字層時不讀 canvas，Tor Browser 不必先允許
export class NoOcrError extends Error {
  override name = "NoOcrError";
}

export async function findPdfText(pages: PdfPages, index: number, bitmap: ImageBitmap, onProgress?: OnProgress, ocr = true): Promise<TextResult> {
  // 讀文字層不必下載模型，不顯示「載入辨識模型中」。需要辨識時由 findText 換回去
  onProgress?.(0);
  const { runs, images } = await pages.layout(index);
  if (textLayerQuality(runs) !== "ok") {
    if (!ocr) throw new NoOcrError();
    assertCanvasReadable();
    return findText(bitmap, onProgress);
  }
  const { width, height } = bitmap;
  const lines = textLines(runs);
  const pii = findPiiInLines(lines, width, height).map((m) => ({ ...m, box: pad(m.box, 0.15, width, height) }));
  const spans = lineBoxes(lines, width, height).map((box) => pad(box, 0.1, width, height));
  if (!ocr || (images !== "page" && !images.length)) return { pii, lines: spans };
  assertCanvasReadable();
  const found = await findText(bitmap, onProgress, images === "page" ? undefined : images);
  return {
    pii: [...pii, ...found.pii.filter((m) => !pii.some((p) => overlaps(p.box, m.box)))],
    lines: [...spans, ...found.lines.filter((box) => !spans.some((s) => overlaps(s, box)))],
  };
}

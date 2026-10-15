import type { Box } from "../tools/redact/index.ts";
import { TILE_MIN_SCORE, faceTiles, mergeFaces } from "../tools/redact/faces.ts";
import { type PiiMatch, type Word, findPii, pad } from "../tools/redact/pii.ts";

// 遮蔽的自動尋找：人臉用 MediaPipe 的 BlazeFace，文字用 Tesseract 辨識之後找出個資。
// 兩者都在瀏覽器裡執行，圖片不離開裝置。WebAssembly 與模型從自己的網域載入
// （scripts/copy-vendor.mjs 複製到 public/vendor/），按下按鈕時才下載。
//
// 自動尋找一定會漏，畫面上把找到的框起來讓讀者逐一確認，不直接套用。

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;

function canvasOf(bitmap: ImageBitmap, x = 0, y = 0, w = bitmap.width, h = bitmap.height): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return canvas;
}

// --- 人臉 ---

// MediaPipe 處理影像一定要用 WebGL，就算偵測本身在 CPU 上跑。關閉 WebGL 的瀏覽器
// （部分隱私強化的設定）沒有辦法自動找人臉
export class NoWebGLError extends Error {}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export async function findFaces(bitmap: ImageBitmap): Promise<Box[]> {
  if (!hasWebGL()) throw new NoWebGLError();
  const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}vendor/mediapipe`);
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${BASE}models/blaze_face_short_range.tflite`, delegate: "CPU" },
    runningMode: "IMAGE",
    minDetectionConfidence: 0.5,
  });
  const found: { box: Box; score: number }[] = [];
  try {
    for (const tile of faceTiles(bitmap.width, bitmap.height)) {
      const result = detector.detect(canvasOf(bitmap, tile.x, tile.y, tile.w, tile.h));
      for (const d of result.detections) {
        const b = d.boundingBox;
        const score = d.categories[0]?.score ?? 0;
        if (!b || (tile.grid > 1 && score < TILE_MIN_SCORE)) continue;
        found.push({ box: { x: tile.x + b.originX, y: tile.y + b.originY, w: b.width, h: b.height }, score });
      }
    }
  } finally {
    detector.close();
  }
  return mergeFaces(found).map((box) => pad(box, 0.2, bitmap.width, bitmap.height));
}

// --- 文字 ---

export interface TextResult {
  pii: PiiMatch[];
  lines: Box[]; // 每一行文字的範圍，讀者想把文字全部框起來時用
}

export async function findText(bitmap: ImageBitmap): Promise<TextResult> {
  const Tesseract = (await import("./tesseract.ts")).default;
  const worker = await Tesseract.createWorker(["chi_tra", "eng"], Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${BASE}vendor/tesseract/worker.min.js`,
    corePath: `${BASE}vendor/tesseract/`,
    langPath: `${BASE}vendor/tessdata`,
    workerBlobURL: false,
    // 語言資料不寫進 IndexedDB，瀏覽器的 HTTP 快取已經夠用
    cacheMethod: "none",
  });
  try {
    const { data } = await worker.recognize(canvasOf(bitmap), {}, { blocks: true });
    const lines: Word[][] = [];
    const boxes: Box[] = [];
    const toBox = (b: { x0: number; y0: number; x1: number; y1: number }): Box => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const words = line.words.filter((w) => w.text.trim() && w.confidence > 30);
          if (!words.length) continue;
          lines.push(words.map((w) => ({ text: w.text, box: toBox(w.bbox) })));
          boxes.push(pad(toBox(line.bbox), 0.1, bitmap.width, bitmap.height));
        }
      }
    }
    const pii = findPii(lines).map((m) => ({ ...m, box: pad(m.box, 0.15, bitmap.width, bitmap.height) }));
    return { pii, lines: boxes };
  } finally {
    await worker.terminate();
  }
}

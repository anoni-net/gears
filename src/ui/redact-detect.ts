import type { Box } from "../tools/redact/index.ts";
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

// BlazeFace 的短距離模型以 128 像素的縮圖偵測，大圖裡的小臉會漏掉。
// 所以整張圖跑一次，再切成 2×2、3×3…的區塊（彼此重疊）各跑一次，一直切到區塊約 640 像素，
// 合併重疊的結果
const TILE = 640;
const OVERLAP = 0.25;

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
    const finest = Math.max(1, Math.ceil(Math.max(bitmap.width, bitmap.height) / TILE));
    for (let n = 1; n <= finest; n++) {
      const tileW = Math.min(bitmap.width, Math.ceil((bitmap.width / n) * (n > 1 ? 1 + OVERLAP : 1)));
      const tileH = Math.min(bitmap.height, Math.ceil((bitmap.height / n) * (n > 1 ? 1 + OVERLAP : 1)));
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const x = Math.max(0, Math.min(bitmap.width - tileW, Math.floor((bitmap.width / n) * col)));
          const y = Math.max(0, Math.min(bitmap.height - tileH, Math.floor((bitmap.height / n) * row)));
          const result = detector.detect(canvasOf(bitmap, x, y, tileW, tileH));
          for (const d of result.detections) {
            const b = d.boundingBox;
            if (!b) continue;
            found.push({ box: { x: x + b.originX, y: y + b.originY, w: b.width, h: b.height }, score: d.categories[0]?.score ?? 0 });
          }
        }
      }
    }
  } finally {
    detector.close();
  }
  return merge(found).map((box) => pad(box, 0.2, bitmap.width, bitmap.height));
}

const area = (b: Box) => b.w * b.h;

function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (area(a) + area(b) - w * h);
}

const contains = (outer: Box, inner: Box) => {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx > outer.x && cx < outer.x + outer.w && cy > outer.y && cy < outer.y + outer.h && area(outer) > area(inner) * 2;
};

// 不同區塊找到的同一張臉只留分數最高的（IoU 超過 0.3 算同一張）。
// 同時包住兩張以上臉的大框是誤判，拿掉
function merge(found: { box: Box; score: number }[]): Box[] {
  const kept: Box[] = [];
  for (const { box } of [...found].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => iou(k, box) > 0.3)) kept.push(box);
  }
  return kept.filter((b) => kept.filter((k) => k !== b && contains(b, k)).length < 2);
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

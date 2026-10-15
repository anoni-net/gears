import type { Box } from "../tools/redact/index.ts";
import { type Detection, faceTiles, mergeFaces } from "../tools/redact/faces.ts";
import { type PiiMatch, type Word, findPii, pad } from "../tools/redact/pii.ts";
import { type OcrWord, textSpans } from "../tools/redact/text-lines.ts";

// 遮蔽的自動尋找：人臉用 MediaPipe 的 BlazeFace，文字用 Tesseract 辨識之後找出個資。
// 兩者都在瀏覽器裡執行，圖片不離開裝置。WebAssembly 與模型從自己的網域載入
// （scripts/copy-vendor.mjs 複製到 public/vendor/），按下按鈕時才下載。
//
// 自動尋找一定會漏，畫面上把找到的框起來讓讀者逐一確認，不直接套用。

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;

// 進度：0 到 1，null 表示還在下載或載入模型，不知道要多久
export type OnProgress = (progress: number | null) => void;

// 偵測在主執行緒上跑，每隔一小段時間讓出一次，畫面才能更新進度、回應操作
const YIELD_MS = 100;
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

export async function findFaces(bitmap: ImageBitmap, onProgress?: OnProgress): Promise<Box[]> {
  if (!hasWebGL()) throw new NoWebGLError();
  onProgress?.(null);
  const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(`${BASE}vendor/mediapipe`);
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${BASE}models/blaze_face_short_range.tflite`, delegate: "CPU" },
    runningMode: "IMAGE",
    minDetectionConfidence: 0.5,
  });
  const found: Detection[] = [];
  try {
    const tiles = faceTiles(bitmap.width, bitmap.height);
    let last = performance.now();
    for (const [i, tile] of tiles.entries()) {
      const result = detector.detect(canvasOf(bitmap, tile.x, tile.y, tile.w, tile.h));
      for (const d of result.detections) {
        const b = d.boundingBox;
        if (!b) continue;
        found.push({
          box: { x: tile.x + b.originX, y: tile.y + b.originY, w: b.width, h: b.height },
          score: d.categories[0]?.score ?? 0,
          grid: tile.grid,
          // 特徵點是區塊內 0 到 1 的相對位置，換成整張圖的像素
          keypoints: d.keypoints.map((k): [number, number] => [tile.x + k.x * tile.w, tile.y + k.y * tile.h]),
        });
      }
      if (performance.now() - last > YIELD_MS) {
        onProgress?.((i + 1) / tiles.length);
        await nextFrame();
        last = performance.now();
      }
    }
    onProgress?.(1);
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

export async function findText(bitmap: ImageBitmap, onProgress?: OnProgress): Promise<TextResult> {
  onProgress?.(null);
  const Tesseract = (await import("./tesseract.ts")).default;
  const worker = await Tesseract.createWorker(["chi_tra", "eng"], Tesseract.OEM.LSTM_ONLY, {
    workerPath: `${BASE}vendor/tesseract/worker.min.js`,
    corePath: `${BASE}vendor/tesseract/`,
    langPath: `${BASE}vendor/tessdata`,
    workerBlobURL: false,
    // 語言資料不寫進 IndexedDB，瀏覽器的 HTTP 快取已經夠用
    cacheMethod: "none",
    // 下載與載入語言資料時不知道要多久，辨識時才有進度
    logger: (m: { status: string; progress: number }) => onProgress?.(m.status === "recognizing text" ? m.progress : null),
  });
  try {
    const { data } = await worker.recognize(canvasOf(bitmap), {}, { blocks: true });
    const lines: Word[][] = [];
    const ocr: OcrWord[][] = [];
    const toBox = (b: { x0: number; y0: number; x1: number; y1: number }): Box => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          ocr.push(line.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text, confidence: w.confidence, box: toBox(w.bbox) })));
          const words = line.words.filter((w) => w.text.trim() && w.confidence > 30);
          if (words.length) lines.push(words.map((w) => ({ text: w.text, box: toBox(w.bbox) })));
        }
      }
    }
    const pii = findPii(lines).map((m) => ({ ...m, box: pad(m.box, 0.15, bitmap.width, bitmap.height) }));
    return { pii, lines: textSpans(ocr).map((box) => pad(box, 0.1, bitmap.width, bitmap.height)) };
  } finally {
    await worker.terminate();
  }
}

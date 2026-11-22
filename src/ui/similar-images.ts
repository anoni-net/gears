import type { Format } from "../core/bytes.ts";
import { DINO_SIZE } from "../tools/verify/dino-model.ts";
import { type PdqHash, pdqFromRGBA } from "../tools/verify/pdq.ts";
import { decodeImage } from "./image-decode.ts";
import { isWasmUnavailable } from "./wasm.ts";

// 查證的相似圖片（src/ui/SimilarImages.tsx）：每張圖解碼一次，算 PDQ 與留下 DINOv2 要的像素。
// 解碼與讀 canvas 都在主執行緒：HEIC 在不支援的瀏覽器上要靠 decodeImage 載入 libheif，讀不讀得到 canvas
// （canvas-access.ts）檢查的也是頁面上的 canvas。一次只解碼一張，手機的大照片不會同時佔好幾份記憶體。
//
// - PDQ：直接畫進長邊 512 的 canvas、讓瀏覽器平滑縮小，讀出來不到 1 MB。照參考實作整張讀出像素再縮小，
//   4,800 萬像素的照片約要 192 MB。評測裡兩種做法在同一批裡分組的結果幾乎相同（召回 55% 與 55%，困難負例都是 0 組），
//   只是跟其他系統算出來的雜湊不一定一樣，所以雜湊不顯示、不匯出
// - DINOv2：整張壓成 224 × 224（不裁切），約 200 KB，留著等讀者按下模型的按鈕再交給 Worker

export interface Prepared {
  width: number;
  height: number;
  pdq: PdqHash;
  pixels: Uint8ClampedArray; // 224 × 224 × 4
  thumb: HTMLCanvasElement; // 長邊 320 的縮圖，只畫、不讀回，畫面用 drawImage 複製過去
}

export type PrepareResult = Prepared | { error: "decode" | "wasm" };

const PDQ_SIDE = 512;
const THUMB_SIDE = 320;

const fit = (width: number, height: number, side: number) => {
  const s = Math.min(1, side / Math.max(width, height));
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))] as const;
};

function draw(bitmap: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

const read = (bitmap: ImageBitmap, w: number, h: number) => draw(bitmap, w, h).getContext("2d")!.getImageData(0, 0, w, h).data;

// 同一個原檔只算一次，換畫面回來、加入其他檔案時不必重算。讀不到 canvas 時不會走到這裡（呼叫前先檢查）
const cache = new WeakMap<Blob, Promise<PrepareResult>>();

export function prepareImage(blob: Blob): Promise<PrepareResult> {
  let job = cache.get(blob);
  if (!job) {
    job = (async (): Promise<PrepareResult> => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await decodeImage(blob);
      } catch (error) {
        return { error: isWasmUnavailable(error) ? "wasm" : "decode" };
      }
      try {
        const { width, height } = bitmap;
        const [w, h] = fit(width, height, PDQ_SIDE);
        const pdq = pdqFromRGBA(read(bitmap, w, h), w, h, { referenceResize: false });
        const pixels = read(bitmap, DINO_SIZE, DINO_SIZE);
        const thumb = draw(bitmap, ...fit(width, height, THUMB_SIDE));
        return { width, height, pdq, pixels, thumb };
      } finally {
        bitmap.close();
      }
    })();
    cache.set(blob, job);
  }
  return job;
}

// 畫面上的圖片格式：瀏覽器解得開、或靠 libheif 解得開的才比對。TIFF、JPEG XL、PNM 這類多數瀏覽器解不開，
// 照樣試一次，解不開的列在「沒有比對」
export const SIMILAR_FORMATS: readonly Format[] = ["jpeg", "png", "heic", "avif", "gif", "webp", "tiff", "bmp", "jxl"];

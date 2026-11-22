// 查證的相似圖片第二層用的 DINOv2 small（src/tools/verify/similar.ts）。讀者按下「也比對裁切、加字之後的版本」才下載，
// 在 Worker 裡執行（src/ui/dino.worker.ts）。Worker 的進入點也匯入這一份，這裡不匯入其他模組。
//
// onnx-community 的轉檔版照原樣放在 assets.anoni.net（onion 版由同一個網站的 /models/assets/ 提供），目錄裡附 README.txt 與
// 上游的授權全文。轉檔的 repo 沒有授權標籤，模型卡寫明轉自 facebook/dinov2-small（Apache-2.0）。每個檔案比對 SHA-256。
// 量化版的選擇與門檻見社群工作區的 research/gears-similar/01-pdq-dinov2.md
export const DINO_MODEL = {
  repo: "onnx-community/dinov2-small-ONNX",
  revision: "08c606e3123472a388efa59181b677d428f69bbd",
  // 上游：facebook/dinov2-small ed25f3a31f01632728cabb09d1542f84ab7b0056
  source: "https://huggingface.co/facebook/dinov2-small",
  license: "Apache-2.0",
  name: "DINOv2 small",
  // Transformers.js 的 dtype int8 讀 onnx/model_int8.onnx
  dtype: "int8",
  dir: "dinov2-small-08c606e",
  // preprocessor_config.json 是 Transformers.js 預設的前處理（短邊 256、中間裁 224），這裡不用：門檻 0.15 是用整張壓成
  // 224 × 224 量出來的，前處理自己做（dino.worker.ts）。檔案照樣放在目錄裡，跟上游一致
  files: {
    "config.json": "afad49655867e7552c0e3d3259f99bbcca3febdbfb3de96315661713b2d23c22",
    "preprocessor_config.json": "14e780d86fa1861f8751f868d7f45425b5feb55c38ca26f152ca5097ab30f828",
    "onnx/model_int8.onnx": "e48d69984ee26d089e5c690cb39a727e38b95e2a525d7269f5ac366b02a6c22a",
  } as Record<string, string>,
  // Worker 實際下載的兩個檔案，沒有壓縮的大小（模型 24.4 MB，權重檔是 application/octet-stream，Cloudflare 不壓縮）
  bytes: 24427763 + 988,
  // 畫面上寫的下載量。還沒放上 assets.anoni.net、量不到經過 Cloudflare 的實際傳輸量，先用沒有壓縮的大小
  transfer: 24427763 + 988,
} as const;

// 畫面上寫的模型下載量（MB）
export const DINO_MB = Math.round(DINO_MODEL.transfer / 1e6);

// 前處理：整張壓成 224 × 224（canvas 縮小，不裁切），ImageNet 的平均與標準差
export const DINO_SIZE = 224;
export const DINO_MEAN = [0.485, 0.456, 0.406] as const;
export const DINO_STD = [0.229, 0.224, 0.225] as const;

// canvas 讀出來的 224 × 224 RGBA 換成模型的輸入（1 × 3 × 224 × 224，通道在前）
export function dinoInput(rgba: ArrayLike<number>): Float32Array {
  const n = DINO_SIZE * DINO_SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[k * n + i] = (rgba[i * 4 + k]! / 255 - DINO_MEAN[k]!) / DINO_STD[k]!;
  return out;
}

// 正規化成長度 1，比對時內積就是 cos
export function normalize(v: ArrayLike<number>): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const norm = Math.sqrt(s) || 1;
  return Float32Array.from(v, (x) => x / norm);
}

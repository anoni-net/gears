// 遮蔽的自動尋找要用到的 WebAssembly 與模型，從 node_modules 複製到 public/vendor/（不進版控）。
// 建置與開發伺服器啟動前自動執行（package.json 的 prebuild、predev）。
// 頁面只從自己的網域載入這些檔案，CSP 不允許連到 CDN。
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FILES = [
  // Tesseract 的文字辨識：worker 與只含 LSTM 的核心，依瀏覽器支援的指令集挑一個
  ["tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract/tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract/tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract/tesseract-core-relaxedsimd-lstm.wasm.js"],
  // 語言資料：正體中文與英文，best_int 版本
  ["@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz", "tessdata/chi_tra.traineddata.gz"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "tessdata/eng.traineddata.gz"],
];

const root = new URL("..", import.meta.url).pathname;
for (const [from, to] of FILES) {
  const source = join(root, "node_modules", from);
  const target = join(root, "public/vendor", to);
  if (!existsSync(source)) throw new Error(`找不到 ${from}，先執行 npm install`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
console.log(`copy-vendor：複製了 ${FILES.length} 個檔案到 public/vendor/`);

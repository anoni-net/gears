// PDF 遮蔽用的 pdf.js 資料，從 node_modules 複製到 public/vendor/（不進版控）。
// 遮蔽的文字辨識模型不在這裡，由 scripts/fetch-whisper.mjs 下載到 public/models/ppocr/。
// 建置與開發伺服器啟動前自動執行（package.json 的 prebuild、predev）。
// 頁面只從自己的網域載入這些檔案，CSP 不允許連到 CDN。
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FILES = [
  // pdf.js 解 JPEG 2000、JBIG2 與色彩描述檔的 WebAssembly，瀏覽器不能編譯 WebAssembly 時的替代版本
  ...["openjpeg.wasm", "openjpeg_nowasm_fallback.js", "jbig2.wasm", "jbig2_nowasm_fallback.js", "qcms_bg.wasm"].map((f) => [`pdfjs-dist/wasm/${f}`, `pdfjs/wasm/${f}`]),
];

// 整個目錄複製：pdf.js 的 CMap（中日韓的字型要用，約 1.8 MB）、PDF 的 14 種標準字型與
// CMYK 的色彩描述檔
const DIRS = [
  ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["pdfjs-dist/iccs", "pdfjs/iccs"],
];

const root = new URL("..", import.meta.url).pathname;
for (const [from, to] of FILES) {
  const source = join(root, "node_modules", from);
  const target = join(root, "public/vendor", to);
  if (!existsSync(source)) throw new Error(`找不到 ${from}，先執行 npm install`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
for (const [from, to] of DIRS) {
  const source = join(root, "node_modules", from);
  if (!existsSync(source)) throw new Error(`找不到 ${from}，先執行 npm install`);
  cpSync(source, join(root, "public/vendor", to), { recursive: true });
}
console.log(`copy-vendor：複製了 ${FILES.length} 個檔案與 ${DIRS.length} 個目錄到 public/vendor/`);

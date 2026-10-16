import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Box } from "../tools/redact/index.ts";

// 用 pdf.js 把 PDF 的頁面畫成圖片，遮蔽的編輯畫面與選擇頁面的縮圖都用它。
//
// PDF 的遮蔽：讀者在圖片上框選，輸出時每一頁重新畫一次、
// 塗黑之後編碼成 JPEG，組成一份只有圖片的新 PDF。原檔的文字、字型、中繼資料、附件、
// 表單與 JavaScript 都不會帶過去，框起來的內容也就不會留在文字層裡。代價是文字不能再
// 選取與搜尋，檔案通常也會變大。
//
// pdf.js 的 CMap（中日韓字型要用）、標準字型與 WebAssembly 解碼器由 scripts/copy-vendor.mjs
// 複製到 public/vendor/pdfjs/，只從自己的網域載入。

GlobalWorkerOptions.workerSrc = workerUrl;

const VENDOR = `${import.meta.env.BASE_URL}vendor/pdfjs/`;

// 編輯與輸出用同一個解析度，框的座標可以直接沿用。150 DPI 足夠看清小字，
// 長邊另設上限，手機的畫布才放得下
const DPI = 150;
const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.9;

export interface PdfPages {
  count: number;
  // 第 index 頁原本的大小，單位是點（1/72 英寸），輸出的每一頁維持原本的大小
  size(index: number): Promise<[number, number]>;
  // 第 index 頁（從 0 開始）畫成的圖片，長邊最多 maxSide 像素（縮圖用比較小的值）。用完要 close()
  render(index: number, maxSide?: number): Promise<ImageBitmap>;
  close(): void;
}

export async function openPdf(data: Uint8Array): Promise<PdfPages> {
  const task = getDocument({
    // pdf.js 會把資料轉交給 worker，原本的陣列會被清空，交一份複本
    data: data.slice(),
    cMapUrl: `${VENDOR}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${VENDOR}standard_fonts/`,
    wasmUrl: `${VENDOR}wasm/`,
    iccUrl: `${VENDOR}iccs/`,
    // 字形直接畫成路徑，不經過 FontFace，頁面不必放寬 CSP 的 font-src
    disableFontFace: true,
    // 圖片一律用 pdf.js 自己的解碼器。Firefox 會先交給瀏覽器的 ImageDecoder，
    // 解不開的圖片在主控台留下錯誤才退回，三種瀏覽器的行為也不一致
    isImageDecoderSupported: false,
    enableXfa: false,
    // 有密碼的 PDF 直接失敗，不跳出輸入密碼的流程
    password: "",
  });
  const doc: PDFDocumentProxy = await task.promise;

  return {
    count: doc.numPages,
    async size(index) {
      const view = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
      return [view.width, view.height];
    },
    async render(index, maxSide = MAX_SIDE) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(DPI / 72, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      // 沒有底色的頁面在 JPEG 裡會變黑，先鋪白底
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport, background: "#fff" }).promise;
      page.cleanup();
      return createImageBitmap(canvas);
    },
    close() {
      void task.destroy();
    },
  };
}

export interface PdfBuildHooks {
  // 每一頁塗黑、編碼之後交回 JPEG，由呼叫的人確認框起來的地方真的是黑的
  check(jpeg: Blob, boxes: Box[]): Promise<void>;
  onProgress(done: number, total: number): void;
}

// 逐頁處理，同一時間只有一頁的圖片在記憶體裡。indices 是要輸出的頁面（從 0 開始），
// 選擇頁面時只輸出選中的那幾頁，沒有框的頁面一樣轉成圖片
export async function buildRedactedPdf(pages: PdfPages, boxes: Box[][], hooks: PdfBuildHooks, indices?: number[]): Promise<Blob> {
  const lib = await import("../tools/strip-metadata/pdf-lib.ts");
  // 不寫入 pdf-lib 預設的 Producer、Creator 與時間
  const out = await lib.PDFDocument.create({ updateMetadata: false });
  const order = indices ?? Array.from({ length: pages.count }, (_, i) => i);
  for (const [done, i] of order.entries()) {
    hooks.onProgress(done, order.length);
    const bitmap = await pages.render(i);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    ctx.fillStyle = "#000";
    const pageBoxes = boxes[i] ?? [];
    for (const b of pageBoxes) ctx.fillRect(b.x, b.y, b.w, b.h);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    canvas.width = canvas.height = 0;
    if (!jpeg) throw new Error("encode");
    if (pageBoxes.length) await hooks.check(jpeg, pageBoxes);
    const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
    const [width, height] = await pages.size(i);
    out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  hooks.onProgress(order.length, order.length);
  const bytes = await out.save();
  // 重新開啟一次，頁數不對或讀不回來的結果不交出去
  const reopened = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  if (reopened.getPageCount() !== order.length) throw new Error("page count");
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

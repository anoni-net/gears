import { canvasReadable } from "./canvas-access.ts";
import { type LineDiff, diffLines } from "../tools/verify/diff.ts";
import { type PdfPages, openPdf } from "./pdf-pages.ts";

// 比對 PDF 的兩個版本：同一頁碼的文字逐行比對，畫面也畫成圖比對，有差異的區塊用紅色標出來。
// 文字比對看得到改了哪些字，畫面比對看得到換掉的圖片、移動的簽名或印章這類沒有文字的變動。
// 頁碼一對一比對，頁面的順序被調換時會變成好幾頁都有差異。

export type PageStatus = "same" | "changed" | "added" | "removed";

export interface PageDiff {
  index: number; // 從 0 開始
  status: PageStatus;
  text: LineDiff;
  visual: boolean; // 畫面上有差異
  sizeChanged: boolean;
  before?: Blob; // 標出差異的圖，新增或刪除的頁面只有一邊
  after?: Blob;
}

export interface Comparison {
  pagesBefore: number;
  pagesAfter: number;
  pages: PageDiff[]; // 只列有差異的頁面
  same: number; // 沒有差異的頁數
  visualSkipped: boolean; // 頁數太多時只比對文字
  visualBlocked: boolean; // 瀏覽器不讓讀取 canvas（Tor Browser），只比對文字
}

const SIDE = 1000; // 比對時畫成長邊 1000 像素
const BLOCK = 8; // 以 8×8 像素為一格判斷有沒有差異
// 一個像素三個顏色的差距加起來超過這個值才算不同。Brave 會在 canvas 讀出的像素加上
// 一點雜訊（防指紋），也有些許反鋸齒的差異，門檻要高過這些
const PIXEL = 60;
const MAX_VISUAL_PAGES = 80;

async function draw(pages: PdfPages, index: number): Promise<HTMLCanvasElement> {
  const bitmap = await pages.render(index, SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d", { willReadFrequently: true })!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

const toPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/png"));

// 找出有差異的格子，回傳每一列連續的格子合成的長方形
function changedBlocks(a: HTMLCanvasElement, b: HTMLCanvasElement): [number, number, number, number][] {
  const w = a.width;
  const h = a.height;
  const da = a.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const db = b.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const rects: [number, number, number, number][] = [];
  for (let by = 0; by < h; by += BLOCK) {
    let run = -1;
    for (let bx = 0; bx <= w; bx += BLOCK) {
      let changed = false;
      if (bx < w) {
        let count = 0;
        for (let y = by; y < Math.min(by + BLOCK, h) && !changed; y++) {
          for (let x = bx; x < Math.min(bx + BLOCK, w); x++) {
            const i = (y * w + x) * 4;
            if (Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) > PIXEL && ++count >= 3) {
              changed = true;
              break;
            }
          }
        }
      }
      if (changed && run < 0) run = bx;
      if (!changed && run >= 0) {
        rects.push([run, by, bx - run, Math.min(BLOCK, h - by)]);
        run = -1;
      }
    }
  }
  return rects;
}

function mark(canvas: HTMLCanvasElement, rects: [number, number, number, number][]) {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(229, 57, 53, 0.35)";
  for (const [x, y, w, h] of rects) ctx.fillRect(x, y, w, h);
}

export async function compareVersions(before: Uint8Array, after: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Comparison> {
  const [a, b] = await Promise.all([openPdf(before), openPdf(after)]);
  try {
    const total = Math.max(a.count, b.count);
    // 讀不到 canvas 的像素時，每一格都會被當成不同，也輸出不了標好差異的圖
    const visualBlocked = !canvasReadable();
    const visualSkipped = visualBlocked || total > MAX_VISUAL_PAGES;
    const pages: PageDiff[] = [];
    let same = 0;
    for (let i = 0; i < total; i++) {
      onProgress?.(i, total);
      if (i >= a.count || i >= b.count) {
        const added = i >= a.count;
        const side = added ? b : a;
        const lines = await side.text(i);
        const image = visualSkipped ? undefined : await toPng(await draw(side, i));
        pages.push({
          index: i,
          status: added ? "added" : "removed",
          text: added ? { removed: [], added: lines } : { removed: lines, added: [] },
          visual: false,
          sizeChanged: false,
          before: added ? undefined : image,
          after: added ? image : undefined,
        });
        continue;
      }
      const text = diffLines(await a.text(i), await b.text(i));
      let visual = false;
      let sizeChanged = false;
      let images: { before?: Blob; after?: Blob } = {};
      if (!visualSkipped) {
        const [ca, cb] = await Promise.all([draw(a, i), draw(b, i)]);
        sizeChanged = ca.width !== cb.width || ca.height !== cb.height;
        const rects = sizeChanged ? [] : changedBlocks(ca, cb);
        visual = sizeChanged || rects.length > 0;
        if (visual) {
          mark(ca, rects);
          mark(cb, rects);
          images = { before: await toPng(ca), after: await toPng(cb) };
        }
        ca.width = ca.height = cb.width = cb.height = 0;
      }
      if (visual || text.added.length || text.removed.length) pages.push({ index: i, status: "changed", text, visual, sizeChanged, ...images });
      else same++;
    }
    onProgress?.(total, total);
    return { pagesBefore: a.count, pagesAfter: b.count, pages, same, visualSkipped, visualBlocked };
  } finally {
    a.close();
    b.close();
  }
}

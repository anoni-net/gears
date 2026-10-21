import type { Page } from "@playwright/test";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from "pdf-lib";
import { DOC_SECRETS, VISIBLE, syntheticPdf } from "../helpers/documents.ts";
import { textPdf } from "../helpers/text-pdf.ts";
import { downloadFrom, expect, test } from "./guard.ts";

const SECRETS = ["SECRET-NAME", "SECRET-AUTHOR", "PAGE-TWO-TEXT"];

// 兩頁的 PDF，每頁 400×200 點、紅底。第一頁左上角一塊綠色，上面寫著名字；
// 第二頁只有一行字。文件資訊裡有作者
async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setAuthor("SECRET-AUTHOR");
  const first = doc.addPage([400, 200]);
  first.drawRectangle({ x: 0, y: 0, width: 400, height: 200, color: rgb(0.82, 0.13, 0.13) });
  // 綠色那塊在左上角 (40,40)-(160,100)，PDF 的座標從左下角算起
  first.drawRectangle({ x: 40, y: 100, width: 120, height: 60, color: rgb(0.13, 0.67, 0.13) });
  first.drawText("SECRET-NAME", { x: 50, y: 125, size: 12, font });
  const second = doc.addPage([400, 200]);
  second.drawRectangle({ x: 0, y: 0, width: 400, height: 200, color: rgb(0.82, 0.13, 0.13) });
  second.drawText("PAGE-TWO-TEXT", { x: 50, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

// 頁面畫好之前框選不會有反應，等載入的訊息換成自動尋找的說明
async function pageReady(page: Page) {
  await expect(page.getByTestId("redact-auto-status")).toContainText("側臉、戴口罩的臉", { timeout: 15000 });
}

async function canvasBox(page: Page) {
  const canvas = page.getByTestId("redact-canvas");
  // 換頁時重新畫，畫好之前不接受輸入
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await canvas.scrollIntoViewIfNeeded();
  return (await canvas.boundingBox())!;
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2));
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1]);
  await page.mouse.up();
}

// 每一頁唯一的圖片就是那一頁的 JPEG
function pageJpegs(doc: PDFDocument): Uint8Array[] {
  return doc.getPages().map((p) => {
    const xobjects = p.node.Resources()!.lookup(PDFName.of("XObject"));
    const [ref] = (xobjects as unknown as { values(): unknown[] }).values();
    const stream = doc.context.lookup(ref as never) as PDFRawStream;
    expect(stream.dict.get(PDFName.of("Filter"))?.toString()).toBe("/DCTDecode");
    return stream.contents;
  });
}

// 在瀏覽器裡解碼 JPEG，讀某一點（相對位置）的顏色
async function pixel(page: Page, jpeg: Uint8Array, x: number, y: number) {
  return page.evaluate(
    async ([bytes, px, py]) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(px * c.width), Math.floor(py * c.height), 1, 1).data.slice(0, 3));
    },
    [Array.from(jpeg), x, y] as [number[], number, number],
  );
}

test("PDF 遮蔽：分頁框選，輸出的每一頁都是圖片，文字與文件資訊不帶過去", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: await samplePdf() });
  // 第一次開啟要下載 pdf.js 與它的 worker，比圖片慢
  await expect(page.getByText("第 1 頁，共 2 頁")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("套用之後每一頁都會轉成圖片")).toBeVisible();
  await expect(page.getByRole("button", { name: "上一頁" })).toBeDisabled();
  await pageReady(page);

  // 綠色那塊相對位置約 (0.1,0.2)-(0.4,0.5)
  await drag(page, [0.08, 0.15], [0.42, 0.55]);
  await expect(page.getByText("全部框了 1 個範圍，這一頁 1 個")).toBeVisible();

  await page.getByRole("button", { name: "下一頁" }).click();
  await expect(page.getByText("第 2 頁，共 2 頁")).toBeVisible();
  await pageReady(page);
  await expect(page.getByText("全部框了 1 個範圍，這一頁 0 個")).toBeVisible();
  // 這一頁沒有框，清除這一頁的框不能按，套用仍然可以
  await expect(page.getByRole("button", { name: "清除這一頁的框" })).toBeDisabled();
  await page.getByRole("button", { name: "上一頁" }).click();
  await pageReady(page);
  await expect(page.getByText("全部框了 1 個範圍，這一頁 1 個")).toBeVisible();

  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("每一頁轉成圖片，原檔的文字、字型、中繼資料、附件與表單都不帶過去")).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toMatch(/\.pdf$/);
  const text = Buffer.from(file.data).toString("latin1");
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain("/Font");
  expect(text).not.toContain("pdf-lib");

  const out = await PDFDocument.load(file.data, { updateMetadata: false });
  expect(out.getPageCount()).toBe(2);
  expect(out.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([
    [400, 200],
    [400, 200],
  ]);
  const [first, second] = pageJpegs(out);
  expect(Math.max(...(await pixel(page, first!, 0.25, 0.35)))).toBeLessThanOrEqual(24);
  const outside = await pixel(page, first!, 0.8, 0.8);
  expect(outside[0]).toBeGreaterThan(180);
  // 沒有框的頁面一樣轉成圖片，原本的紅底還在
  expect((await pixel(page, second!, 0.8, 0.8))[0]).toBeGreaterThan(180);
});

test("PDF 遮蔽：XMP、註解的作者、文件識別碼與舊版本留下的物件都不帶過去", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from(await syntheticPdf()) });
  await expect(page.getByText("第 1 頁，共 1 頁")).toBeVisible({ timeout: 15000 });
  await pageReady(page);
  // 只有一頁時不顯示「這一頁」的框數
  await drag(page, [0.6, 0.6], [0.9, 0.9]);
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible({ timeout: 15000 });
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const text = Buffer.from(file.data).toString("latin1");
  for (const secret of [...DOC_SECRETS, VISIBLE, "Jane Doe", "FIELD-NAME", "5345435245542d4943"]) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/\/(Metadata|Annots|ID|Info|PieceInfo)\b/);
});

test("PDF 打不開時說明原因，不顯示畫布", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nbroken") });
  await expect(page.getByText("沒有辦法開啟這份 PDF")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "套用遮蔽" })).toBeDisabled();
});

// 白底黑字的圖，寫著一支電話。英文與數字，CI 沒有中文字型
async function phoneImage(page: Page): Promise<Buffer> {
  const data = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 360;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    g.font = "64px sans-serif";
    g.fillText("Tel 0987-654-321", 40, 200);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  return Buffer.from(data);
}

// 記下有沒有下載 Tesseract 的程式或語言資料
function watchOcr(page: Page): () => boolean {
  let used = false;
  page.on("request", (r) => {
    if (/vendor\/(tesseract|tessdata)\//.test(r.url())) used = true;
  });
  return () => used;
}

test("PDF 有文字層時直接讀，不下載 Tesseract，框蓋住原本的文字", async ({ page }) => {
  const ocr = watchOcr(page);
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "contact.pdf", mimeType: "application/pdf", buffer: await textPdf() });
  await expect(page.getByText("第 1 頁，共 1 頁")).toBeVisible({ timeout: 15000 });
  await pageReady(page);
  await page.getByRole("button", { name: "找電話、Email 等個資" }).click();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("加了 2 個框，請逐一確認，框錯的點一下就會拿掉。");
  await page.getByRole("button", { name: /框起所有文字/ }).click();
  await expect(page.getByText("已經框了 3 個範圍")).toBeVisible();
  expect(ocr()).toBe(false);

  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible({ timeout: 15000 });
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const [jpeg] = pageJpegs(await PDFDocument.load(file.data, { updateMetadata: false }));
  // 電話的第一個與最後一個數字（約 x 76 與 147 點）、Email 的頭尾，基線往上 4 點，都要是黑的
  for (const [x, y] of [
    [77, 164],
    [146, 164],
    [52, 144],
    [165, 144],
  ] as const) {
    expect(Math.max(...(await pixel(page, jpeg!, x / 400, 1 - y / 200)))).toBeLessThanOrEqual(24);
  }
});

test("PDF 上的圖片另外辨識，跟文字層找到的合在一起", async ({ page }) => {
  test.setTimeout(120_000);
  const ocr = watchOcr(page);
  await page.goto("./redact/");
  const image = await phoneImage(page);
  await page.getByTestId("file-input").setInputFiles({ name: "mixed.pdf", mimeType: "application/pdf", buffer: await textPdf(image) });
  await expect(page.getByText("第 1 頁，共 1 頁")).toBeVisible({ timeout: 15000 });
  await pageReady(page);
  await page.getByRole("button", { name: "找電話、Email 等個資" }).click();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("加了 3 個框，請逐一確認，框錯的點一下就會拿掉。", { timeout: 90_000 });
  expect(ocr()).toBe(true);
});

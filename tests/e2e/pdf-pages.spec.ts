import { PDFDocument, StandardFonts } from "pdf-lib";
import { downloadFrom, expect, test } from "./guard.ts";

// 三頁的 PDF，內容串流不壓縮，檔案裡直接看得到每一頁的字。作者寫在文件資訊裡
async function threePages(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setAuthor("AUTHOR-SECRET");
  for (const label of ["PAGE-ONE-TEXT", "PAGE-TWO-SECRET", "PAGE-THREE-TEXT"]) {
    const page = doc.addPage([300, 400]);
    page.drawText(label, { x: 40, y: 200, size: 18, font });
    // drawText 把字編成十六進位，另外放一段看得到原文的內容，方便比對
    page.node.addContentStream(doc.context.register(doc.context.stream(`% ${label}`)));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

test("從任務選 PDF，勾選第一頁與第三頁，第二頁與文件資訊不在新檔裡", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /只交出 PDF 的其中幾頁/ }).click()]);
  await chooser.setFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: await threePages() });

  const apply = page.getByRole("button", { name: "只留下選中的頁面" });
  await expect(page.getByRole("checkbox", { name: "第 3 頁" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("選了 0 頁，共 3 頁")).toBeVisible();
  await expect(apply).toBeDisabled();

  // 全選時沒有頁面可以拿掉，也不能套用
  await page.getByRole("button", { name: "全選" }).click();
  await expect(page.getByText("選了 3 頁，共 3 頁")).toBeVisible();
  await expect(apply).toBeDisabled();
  await page.getByRole("button", { name: "全部不選" }).click();

  await page.getByRole("checkbox", { name: "第 1 頁" }).check();
  await page.getByRole("checkbox", { name: "第 3 頁" }).check();
  await expect(page.getByText("選了 2 頁，共 3 頁")).toBeVisible();
  // 縮圖畫好了
  await expect(page.locator(".page-thumb.drawn")).toHaveCount(3, { timeout: 15000 });
  await apply.click();

  await expect(page.getByText("選擇頁面後", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("沒有選的 1 頁")).toBeVisible();
  await expect(page.getByText("選中的 2 頁，頁面上的內容保留原樣")).toBeVisible();
  // 三頁共用同一個字型，提醒字型裡可能還有其他頁的字
  await expect(page.getByText(/選中的頁面跟拿掉的頁面共用字型/)).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const out = Buffer.from(file.data).toString("latin1");
  expect(out).toContain("PAGE-ONE-TEXT");
  expect(out).toContain("PAGE-THREE-TEXT");
  expect(out).not.toContain("PAGE-TWO-SECRET");
  expect(out).not.toContain("AUTHOR-SECRET");
  const doc = await PDFDocument.load(file.data);
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getAuthor()).toBeUndefined();
});

test("轉成圖片：只留下選中的頁面，字型與文字層都不帶過去", async ({ page }) => {
  await page.goto("./pdf-pages/");
  await page.getByTestId("file-input").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: await threePages() });
  await page.getByRole("checkbox", { name: "第 2 頁" }).check({ timeout: 15000 });
  await page.getByRole("checkbox", { name: /轉成圖片/ }).check();
  await page.getByRole("button", { name: "只留下選中的頁面" }).click();
  await expect(page.getByText("選擇頁面後", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("沒有選的 2 頁")).toBeVisible();
  await expect(page.getByText("每一頁轉成圖片，原檔的文字、字型、中繼資料、附件與表單都不帶過去")).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const out = Buffer.from(file.data).toString("latin1");
  for (const gone of ["PAGE-ONE-TEXT", "PAGE-TWO-SECRET", "PAGE-THREE-TEXT", "AUTHOR-SECRET", "/Font"]) expect(out).not.toContain(gone);
  expect(out).toContain("/DCTDecode");
  expect((await PDFDocument.load(file.data)).getPageCount()).toBe(1);
});

test("放大檢視：畫成大圖，可以換頁、勾選，關掉之後勾選留著", async ({ page }) => {
  // 手機的寬度，符合寬度時頁面比畫出來的像素小，再放大才有作用
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("./pdf-pages/");
  await page.getByTestId("file-input").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: await threePages() });
  await page.getByRole("button", { name: "放大第 2 頁" }).click({ timeout: 15000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("第 2 頁，共 3 頁")).toBeVisible();
  // 大圖的寬度遠大於縮圖
  await expect(page.getByTestId("page-zoom-canvas")).not.toHaveClass(/waiting/, { timeout: 15000 });
  const width = await page.getByTestId("page-zoom-canvas").evaluate((c: HTMLCanvasElement) => c.width);
  expect(width).toBeGreaterThan(500);
  // 再放大：比對話框寬，可以左右捲動；不超過畫出來的像素
  const stage = page.locator(".page-zoom-stage");
  const fitWidth = (await page.getByTestId("page-zoom-canvas").boundingBox())!.width;
  await dialog.getByRole("button", { name: "再放大" }).click();
  await expect(dialog.getByRole("button", { name: "符合寬度" })).toHaveAttribute("aria-pressed", "true");
  const enlarged = (await page.getByTestId("page-zoom-canvas").boundingBox())!.width;
  expect(enlarged).toBeGreaterThan(fitWidth * 1.2);
  expect(enlarged).toBeLessThanOrEqual(width + 1);
  expect(await stage.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "符合寬度" }).click();

  await dialog.getByRole("checkbox", { name: "留下這一頁" }).check();
  await dialog.getByRole("button", { name: "下一頁" }).click();
  await expect(dialog.getByText("第 3 頁，共 3 頁")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "留下這一頁" })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "下一頁" })).toBeDisabled();
  await dialog.getByRole("button", { name: "回到所有頁面" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("checkbox", { name: "第 2 頁" })).toBeChecked();
  await expect(page.getByText("選了 1 頁，共 3 頁")).toBeVisible();

  // Escape 也能關掉
  await page.getByRole("button", { name: "放大第 1 頁" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("只有一頁的 PDF 說明沒有可以拿掉的頁面", async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  await page.goto("./pdf-pages/");
  await page.getByTestId("file-input").setInputFiles({ name: "one.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.getByText("這份 PDF 只有一頁，沒有可以拿掉的頁面。")).toBeVisible({ timeout: 15000 });
  await page.getByRole("checkbox", { name: "第 1 頁" }).check();
  await expect(page.getByRole("button", { name: "只留下選中的頁面" })).toBeDisabled();
});

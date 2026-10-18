import type { Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { sniff } from "../../src/core/bytes.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 一張「掃描的頁面」：白紙、黑色的字、每 16 像素一個 2×2 的淡黃色追蹤點、一條螢光筆
async function scannedPage(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const c = new OffscreenCanvas(240, 160);
    const g = c.getContext("2d")!;
    g.fillStyle = "rgb(250,250,248)";
    g.fillRect(0, 0, 240, 160);
    g.fillStyle = "rgb(255,252,205)";
    for (let y = 4; y < 160; y += 16) for (let x = 4; x < 240; x += 16) g.fillRect(x, y, 2, 2);
    g.fillStyle = "rgb(255,240,30)";
    g.fillRect(20, 100, 120, 14);
    g.fillStyle = "rgb(20,20,20)";
    g.fillRect(30, 40, 150, 10);
    const blob = await c.convertToBlob({ type: "image/png" });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(bytes);
}

// 讀回輸出的圖片在幾個位置的顏色
async function colorsAt(page: Page, data: Uint8Array, points: [number, number][]) {
  return page.evaluate(
    async ([bytes, pts]) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = c.getContext("2d")!;
      g.drawImage(bitmap, 0, 0);
      return pts.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]);
    },
    [[...data], points] as const,
  );
}

test("從桌面的工具選掃描的頁面：找到淡黃色，去掉之後追蹤點變白，螢光筆與字還在", async ({ page }) => {
  await page.goto("./");
  const png = await scannedPage(page);
  await page.getByRole("button", { name: /^列印追蹤點/ }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".intro").getByRole("button", { name: "選擇檔案" }).click()]);
  await chooser.setFiles({ name: "scan.png", mimeType: "image/png", buffer: png });

  await expect(page.getByTestId("print-dots-status")).toContainText("找到淡黃色的像素");
  await page.getByRole("button", { name: "只看黃色" }).click();
  await expect(page.getByRole("button", { name: "只看黃色" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByText("接近白色的淡黃色像素改成白色", { exact: false })).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(sniff(file.data)).toBe("png");
  const [dot, highlighter, text] = await colorsAt(page, file.data, [[4, 4], [60, 106], [60, 44]]);
  expect(dot).toEqual([255, 255, 255]);
  expect(highlighter![2]).toBeLessThan(80);
  expect(text).toEqual([20, 20, 20]);
});

test("轉成黑白：只剩黑與白", async ({ page }) => {
  await page.goto("./print-dots/");
  await page.getByTestId("file-input").setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: await scannedPage(page) });
  await expect(page.getByTestId("print-dots-status")).toContainText("找到淡黃色的像素");
  await page.getByRole("radio", { name: /轉成黑白/ }).check();
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByText("轉成黑白，淡黃色的追蹤點", { exact: false })).toBeVisible();
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const colors = await colorsAt(page, file.data, [[4, 4], [60, 106], [60, 44], [200, 150]]);
  expect(colors).toEqual([[255, 255, 255], [255, 255, 255], [0, 0, 0], [255, 255, 255]]);
});

test("掃描的 PDF：每一頁處理之後組回只有圖片的 PDF", async ({ page }) => {
  await page.goto("./print-dots/");
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(await scannedPage(page));
  doc.addPage([240, 160]).drawImage(image, { x: 0, y: 0, width: 240, height: 160 });
  await page.getByTestId("file-input").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await expect(page.getByTestId("print-dots-status")).toContainText("找到淡黃色的像素", { timeout: 15000 });
  await page.getByRole("radio", { name: /轉成黑白/ }).check();
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByText("每一頁轉成圖片", { exact: false })).toBeVisible({ timeout: 20000 });
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(sniff(file.data)).toBe("pdf");
  expect((await PDFDocument.load(file.data)).getPageCount()).toBe(1);
});

import type { Page } from "@playwright/test";
import { downloadFrom, expect, test } from "./guard.ts";
import { indexOf, sniff } from "../../src/core/bytes.ts";
import { parseExif } from "../../src/tools/strip-metadata/exif.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { exifSegment, insertIntoJpeg, insertIntoPng, metadataChunks, sampleTiff, bytes as text } from "../helpers/fixtures.ts";
import { concat } from "../../src/core/bytes.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

// 在瀏覽器裡用 canvas 畫一張真的可以解碼的圖，回到 Node 再塞進中繼資料
async function canvasImage(page: Page, type: "image/jpeg" | "image/png"): Promise<Uint8Array> {
  const data = await page.evaluate(async (mime) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#c33";
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = "#3a3";
    g.fillRect(0, 0, 32, 24);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), mime, 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, type);
  return new Uint8Array(data);
}

async function addFile(page: Page, name: string, mimeType: string, data: Uint8Array) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType, buffer: Buffer.from(data) });
}

async function download(page: Page): Promise<Uint8Array> {
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toMatch(/^gears-1\.(jpg|png)$/);
  return file.data;
}

async function previewLoaded(page: Page) {
  const img = page.locator(".preview img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
}

test("桌面有暫存區、任務捷徑與兩組工具，沒有檔案時不顯示清空按鈕", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "隱私工作台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暫存區" })).toBeVisible();
  await expect(page.getByRole("button", { name: /分享照片前，拿掉拍攝位置/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /把 Wi-Fi 密碼傳給朋友/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "處理檔案" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "從空白開始" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清空暫存區" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回到桌面" })).toHaveCount(0);
});

test("JPEG：找出位置、清除、下載，旋轉方向保留", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff(6)));
  const withTrailer = concat([jpeg, text("MOTION-PHOTO-SECRET")]);
  await addFile(page, "IMG_20261014_093000.jpg", "image/jpeg", withTrailer);

  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();
  await expect(page.getByText("TestMaker SECRET-MODEL")).toBeVisible();
  await previewLoaded(page);

  await page.getByRole("button", { name: "清除中繼資料" }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  await expect(page.getByText("EXIF：位置、手機型號、拍攝時間與縮圖")).toBeVisible();
  await expect(page.getByText("旋轉方向，直拍的照片才不會變成橫的")).toBeVisible();
  await previewLoaded(page);

  const out = await download(page);
  expect(sniff(out)).toBe("jpeg");
  expect(stripMetadata.inspect(out, "jpeg")).toEqual([]);
  expect(Buffer.from(out).includes("MOTION-PHOTO-SECRET")).toBe(false);
  const exifAt = indexOf(out, "Exif\0\0");
  expect(parseExif(out.subarray(exifAt + 6)).orientation).toBe(6);
});

test("退回上一步，再清空暫存區", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, "photo.jpg", "image/jpeg", jpeg);
  await page.getByRole("button", { name: "清除中繼資料" }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();

  await page.getByRole("button", { name: "退回上一步" }).click();
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "退回上一步" })).toHaveCount(0);

  await page.getByRole("button", { name: "清空暫存區" }).click();
  await expect(page.getByRole("button", { name: /分享照片前，拿掉拍攝位置/ })).toBeVisible();
  await expect(page.locator(".tray .item")).toHaveCount(0);
  await expect(page.getByText("把檔案拖進來，或")).toBeVisible();
});

test("PNG：文字欄位與 eXIf 一起拿掉", async ({ page }) => {
  const png = insertIntoPng(await canvasImage(page, "image/png"), ...metadataChunks());
  await addFile(page, "screenshot.png", "image/png", png);
  await expect(page.getByText("作者或擁有者的名字")).toBeVisible();
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "清除中繼資料" }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  await previewLoaded(page);

  const out = await download(page);
  expect(sniff(out)).toBe("png");
  expect(stripMetadata.inspect(out, "png")).toEqual([]);
  expect(Buffer.from(out).includes("Jane Doe")).toBe(false);
});

test("一次加入多個檔案，可以在暫存區切換", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  const png = await canvasImage(page, "image/png");
  await page.getByTestId("file-input").setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) },
    { name: "b.png", mimeType: "image/png", buffer: Buffer.from(png) },
  ]);
  await expect(page.locator(".tray .item")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "a.jpg" })).toBeVisible();
  await page.getByRole("button", { name: /^b\.png/ }).click();
  await expect(page.getByRole("heading", { name: "b.png" })).toBeVisible();
  // 移除其中一個，另一個留著
  await page.getByRole("button", { name: "從暫存區移除：b.png" }).click();
  await expect(page.locator(".tray .item")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "a.jpg" })).toBeVisible();
});

test("很長的檔名不會把版面撐出橫向捲軸", async ({ page }) => {
  const jpeg = insertIntoJpeg(await canvasImage(page, "image/jpeg"), exifSegment(sampleTiff()));
  await addFile(page, `IMG_20261014_093000_${"very_long_name_".repeat(6)}.jpg`, "image/jpeg", jpeg);
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("不能預覽的檔案說明清楚，只提供加密", async ({ page }) => {
  await addFile(page, "notes.txt", "text/plain", text("hello"));
  await expect(page.getByText("這種檔案不能預覽")).toBeVisible();
  await expect(page.locator(".tray .item")).toContainText("不能預覽");
  await expect(page.getByRole("button", { name: "清除中繼資料" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加密" })).toBeVisible();
});

test("正式建置帶著 CSP，限制頁面能連線的對象", async ({ page, guard }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/", { method: "POST", body: "x" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  // CSP 擋下時瀏覽器會在主控台留下錯誤，這裡是預期中的
  guard.errors = [];
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://example.com"));
});

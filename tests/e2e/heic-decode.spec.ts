import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { sniff } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { GENERATED, QR_TEXT } from "../global-setup.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 真的 HEIC 由 tests/global-setup.ts 用 pillow-heif 產生：紅底、左上角一塊綠色，帶拍攝位置。
// 瀏覽器不能直接顯示時，工作台載入 libheif 解碼。
const PHOTO = `${GENERATED}/photo.heic`;
const QR = `${GENERATED}/qr.heic`;
test.skip(!existsSync(PHOTO), "沒有 HEIC 測試檔（需要 pillow-heif）");
test.setTimeout(60_000);

const heic = (path: string) => ({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: readFileSync(path) });

// 預覽圖上某個相對位置的顏色
async function pixel(page: Page, x: number, y: number) {
  const img = page.locator(".preview img");
  await expect(img).toBeVisible({ timeout: 30_000 });
  return img.evaluate(
    async (el: HTMLImageElement, [px, py]) => {
      await el.decode();
      const c = document.createElement("canvas");
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(el, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(px * c.width), Math.floor(py * c.height), 1, 1).data.slice(0, 3));
    },
    [x, y] as [number, number],
  );
}

const isGreen = ([r, g, b]: number[]) => g! > 130 && r! < 90 && b! < 110;
const isRed = ([r, g, b]: number[]) => r! > 170 && g! < 90 && b! < 90;

test("HEIC 的預覽：瀏覽器不能顯示時用 libheif 解碼，顏色與位置正確", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles(heic(PHOTO));
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();
  expect(isGreen(await pixel(page, 0.2, 0.2))).toBe(true);
  expect(isRed(await pixel(page, 0.8, 0.8))).toBe(true);
});

test("從任務把 HEIC 轉成 JPEG，下載的 JPEG 沒有中繼資料", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /把 iPhone 照片轉成 JPEG/ }).click()]);
  await chooser.setFiles(heic(PHOTO));
  await page.getByRole("button", { name: "轉成 JPEG", exact: true }).click();
  await expect(page.getByText("轉成 JPEG 後", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  expect(isGreen(await pixel(page, 0.2, 0.2))).toBe(true);

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toBe("gears-1.jpg");
  expect(sniff(file.data)).toBe("jpeg");
  expect((await stripMetadata.inspect(file.data, "jpeg"))).toEqual([]);
});

test("遮蔽 HEIC：解碼之後框選塗黑，輸出 JPEG", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles(heic(PHOTO));
  await page.getByRole("button", { name: "開始框選" }).click();
  const canvas = page.getByTestId("redact-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.05, b.y + b.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
  await page.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.45);
  await page.mouse.up();
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible();
  expect(Math.max(...(await pixel(page, 0.2, 0.2)))).toBeLessThanOrEqual(24);
  expect(isRed(await pixel(page, 0.8, 0.8))).toBe(true);
});

test("HEIC 裡的 QR code：檔案畫面與 QR code 讀取都讀得出來", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles(heic(QR));
  await expect(page.getByTestId("qr-text")).toHaveText(QR_TEXT, { timeout: 30_000 });

  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles(heic(QR));
  await expect(page.getByTestId("qr-text")).toHaveText(QR_TEXT, { timeout: 30_000 });
});

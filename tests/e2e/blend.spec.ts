import type { Page } from "@playwright/test";
import { sniff } from "../../src/core/bytes.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 一張手機原始解析度的照片：漸層加上細的格線，縮小時看得出有沒有鋸齒
async function photo(page: Page, width: number, height: number): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ([w, h]) => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#3a7bd5");
      grad.addColorStop(1, "#f4d03f");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#222";
      for (let x = 0; x < w; x += 40) g.fillRect(x, 0, 2, h);
      const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.97 });
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    [width, height] as const,
  );
  return Buffer.from(bytes);
}

async function sizeOf(page: Page, data: Uint8Array) {
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    return [bitmap.width, bitmap.height];
  }, [...data]);
}

test("縮成常見尺寸：直的照片依高度縮到 1280，輸出 JPEG", async ({ page }) => {
  await page.goto("./blend/");
  await page.getByTestId("file-input").setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await photo(page, 1800, 2400) });
  await expect(page.getByTestId("blend-original")).toHaveText("原圖 1800 × 2400 像素");
  await expect(page.getByText("輸出 1200 × 1600 像素")).toBeVisible();
  await page.getByRole("radio", { name: /1280 像素/ }).check();
  await page.getByRole("button", { name: "縮小並重新壓縮" }).click();
  await expect(page.getByText("長邊縮成 1280 像素")).toBeVisible();
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(sniff(file.data)).toBe("jpeg");
  expect(await sizeOf(page, file.data)).toEqual([960, 1280]);
});

test("比常見尺寸小的照片不放大，只重新壓縮", async ({ page }) => {
  await page.goto("./blend/");
  await page.getByTestId("file-input").setInputFiles({ name: "small.jpg", mimeType: "image/jpeg", buffer: await photo(page, 800, 600) });
  await expect(page.getByText("原圖比這個小，不放大，只重新壓縮").first()).toBeVisible();
  await page.getByRole("button", { name: "縮小並重新壓縮" }).click();
  await expect(page.getByText("用一般的參數（JPEG 品質 85）重新壓縮", { exact: false })).toBeVisible();
  await expect(page.getByText("長邊縮成", { exact: false })).toHaveCount(0);
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(await sizeOf(page, file.data)).toEqual([800, 600]);
});

import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { SVG_SOURCE } from "../helpers/fixtures.ts";
import { GENERATED } from "../global-setup.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 真的 WebP、AVIF、GIF、TIFF 由 tests/global-setup.ts 產生
test.skip(!existsSync(`${GENERATED}/photo.webp`), "沒有測試圖片（需要 pillow-heif）");

async function add(page: Page, name: string, buffer: Buffer) {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}

async function cleanAndDownload(page: Page, format: Format, ext: string) {
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toBe(`gears-1.${ext}`);
  expect(sniff(file.data)).toBe(format);
  expect((await stripMetadata.inspect(file.data, format))).toEqual([]);
}

for (const [ext, format, finding] of [
  ["webp", "webp", "25.03300, 121.56540"],
  ["avif", "avif", "25.03300, 121.56540"],
  ["gif", "gif", "Created by Jane Doe"],
  ["tiff", "tiff", "Jane Doe at home"],
] as const) {
  test(`${ext.toUpperCase()}：列出資訊、清除、下載`, async ({ page }) => {
    await add(page, `photo.${ext}`, readFileSync(`${GENERATED}/photo.${ext}`));
    await expect(page.getByText(finding)).toBeVisible();
    // 預覽：瀏覽器顯示得了就是圖，顯示不了（TIFF 多半只有 Safari 可以）就是說明
    await expect(page.locator(".preview img, .preview .hint").first()).toBeVisible();
    await cleanAndDownload(page, format, ext);
  });
}

test("SVG：列出電腦上的路徑，清除之後預覽照常", async ({ page }) => {
  await add(page, "plan.svg", Buffer.from(SVG_SOURCE));
  await expect(page.getByText("/home/janedoe/Documents/plan.png")).toBeVisible();
  await cleanAndDownload(page, "svg", "svg");
  const img = page.locator(".preview img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

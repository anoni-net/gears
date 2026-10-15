import type { Page } from "@playwright/test";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { syntheticFlac, syntheticMkv, syntheticMp3, syntheticMp4 } from "../helpers/media.ts";
import { downloadFrom, expect, test } from "./guard.ts";

async function add(page: Page, name: string, data: Uint8Array) {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(data) });
}

async function cleanAndDownload(page: Page, format: Format) {
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toBe(`gears-1.${format}`);
  expect(sniff(file.data)).toBe(format);
  expect((await stripMetadata.inspect(file.data, format)).filter((f) => f.code !== "attachments")).toEqual([]);
}

for (const [name, file, format, finding] of [
  ["clip.mp4", syntheticMp4, "mp4", "25.03300, 121.56540"],
  ["song.mp3", syntheticMp3, "mp3", "SECRET-TITLE"],
  ["song.flac", syntheticFlac, "flac", "Jane Doe"],
  ["clip.mkv", () => syntheticMkv(), "mkv", "SECRET-MUX"],
] as const) {
  test(`${format.toUpperCase()}：列出資訊、清除、下載`, async ({ page }) => {
    await add(page, name, file());
    await expect(page.getByText(finding).first()).toBeVisible();
    // 播放器：瀏覽器播得了就顯示，播不了（測試檔的影音資料是假的）就是說明
    await expect(page.locator(".preview video, .preview audio, .preview .hint").first()).toBeAttached();
    await cleanAndDownload(page, format);
  });
}

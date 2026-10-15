import type { Page } from "@playwright/test";
import { sniff } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { gzipWithName, syntheticTar, syntheticTorrent, syntheticZip } from "../helpers/archives.ts";
import { downloadFrom, expect, test } from "./guard.ts";

async function add(page: Page, name: string, data: Uint8Array) {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(data) });
}

async function clean(page: Page) {
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  return downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
}

test("ZIP：列出系統檔與照片的位置，清除後沿用原本的副檔名", async ({ page }) => {
  await add(page, "photos.cbz", syntheticZip());
  await expect(page.getByText("__MACOSX", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();
  const file = await clean(page);
  expect(file.name).toBe("gears-1.cbz");
  expect(sniff(file.data)).toBe("zip");
  expect(await stripMetadata.inspect(file.data, "zip")).toEqual([]);
  await expect(page.getByText("作業系統留下的檔案：", { exact: false })).toBeVisible();
});

test("TAR.GZ：壓縮前的檔名與擁有者，清除後副檔名維持 .tar.gz", async ({ page }) => {
  await add(page, "backup.tar.gz", await gzipWithName(syntheticTar()));
  await expect(page.getByText("SECRET-NAME.tar")).toBeVisible();
  await expect(page.getByText("janedoe", { exact: false })).toBeVisible();
  const file = await clean(page);
  expect(file.name).toBe("gears-1.tar.gz");
  expect(await stripMetadata.inspect(file.data, "gz")).toEqual([]);
});

test("種子檔：建立的程式與註解", async ({ page }) => {
  await add(page, "video.torrent", syntheticTorrent());
  await expect(page.getByText("SECRET-CLIENT")).toBeVisible();
  const file = await clean(page);
  expect(file.name).toBe("gears-1.torrent");
});

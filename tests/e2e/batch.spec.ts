import { sniff } from "../../src/core/bytes.ts";
import { entryData, readZip } from "../../src/core/zip.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { syntheticDocx } from "../helpers/documents.ts";
import { syntheticFlac, syntheticMp3 } from "../helpers/media.ts";
import { downloadFrom, expect, test } from "./guard.ts";

test("一次清除全部的檔案，再下載成一個壓縮檔", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles([
    { name: "2024-06-01 會議紀錄.docx", mimeType: "application/octet-stream", buffer: Buffer.from(await syntheticDocx()) },
    { name: "錄音.mp3", mimeType: "audio/mpeg", buffer: Buffer.from(syntheticMp3()) },
    { name: "song.flac", mimeType: "audio/flac", buffer: Buffer.from(syntheticFlac()) },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("plain text") },
  ]);
  const batch = page.getByTestId("batch");
  await batch.getByRole("button", { name: "清除 3 個檔案的中繼資料" }).click();
  await expect(batch.getByText("清除了 3 個檔案。")).toBeVisible();
  await expect(batch.getByRole("button", { name: "沒有需要清除的檔案" })).toBeDisabled();
  await expect(page.locator(".item .status.warn")).toHaveCount(0);

  const file = await downloadFrom(page, () => batch.getByRole("button", { name: "全部下載成一個壓縮檔" }).click());
  expect(file.name).toBe("gears.zip");
  const { entries } = readZip(file.data);
  expect(entries.map((e) => e.name)).toEqual(["gears-1.docx", "gears-2.mp3", "gears-3.flac", "gears-4.txt"]);
  for (const entry of entries.slice(0, 3)) {
    const data = await entryData(file.data, entry);
    const findings = await stripMetadata.inspect(data, sniff(data));
    expect(findings.filter((f) => stripMetadata.resolves.includes(f.code))).toEqual([]);
  }
});

test("只有一個檔案時不顯示一次處理的按鈕", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "a.mp3", mimeType: "audio/mpeg", buffer: Buffer.from(syntheticMp3()) });
  await expect(page.getByText("檔案裡找到的資訊")).toBeVisible();
  await expect(page.getByTestId("batch")).toHaveCount(0);
});

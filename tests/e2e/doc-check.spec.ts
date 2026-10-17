import { sniff } from "../../src/core/bytes.ts";
import { checkDocument } from "../../src/tools/doc-check/index.ts";
import { cleanPdf, trackedDocx, trackedPdf } from "../helpers/tracked-docs.ts";
import { downloadFrom, expect, test } from "./guard.ts";

test("從任務選有巨集的 Word：列出打開時會連到的位址、網路芳鄰、巨集與連結", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /來路不明的文件/ }).click()]);
  await chooser.setFiles({ name: "invite.docm", mimeType: "application/octet-stream", buffer: Buffer.from(await trackedDocx()) });

  const verdict = page.getByTestId("doc-check-verdict");
  await expect(verdict).toContainText("打開時會連到外面");
  await expect(verdict).toContainText("記錄了 4 個打開時會去連線的外部位址");
  await expect(page.getByText("tracker.example.net", { exact: true })).toBeVisible();
  await expect(page.getByText("pixel.example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("網路芳鄰位址")).toBeVisible();
  await expect(page.getByRole("heading", { name: "會執行的程式" })).toBeVisible();
  await expect(page.getByText("巨集", { exact: true })).toBeVisible();
  await page.getByText("點了才會連的連結（1 個）").click();
  await expect(page.getByText("news.example.org", { exact: true })).toBeVisible();
  // Office 文件沒有轉成安全版本的按鈕，只有說明
  await expect(page.getByRole("button", { name: "轉成安全的 PDF" })).toHaveCount(0);
  await expect(page.getByText("不要按「啟用編輯」或「啟用內容」", { exact: false })).toBeVisible();
});

test("PDF：打開時的動作與 JavaScript，轉成安全的 PDF 之後什麼都不剩", async ({ page }) => {
  await page.goto("./doc-check/");
  await page.getByTestId("file-input").setInputFiles({ name: "notice.pdf", mimeType: "application/pdf", buffer: Buffer.from(await trackedPdf()) });
  await expect(page.getByTestId("doc-check-verdict")).toContainText("打開時會連到外面");
  await expect(page.getByText("open.example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("打開時執行的 JavaScript")).toBeVisible();
  await expect(page.getByText("開啟其他程式或檔案")).toBeVisible();
  await expect(page.getByText("invoice.exe")).toBeVisible();

  await page.getByRole("button", { name: "轉成安全的 PDF" }).click();
  await expect(page.getByText("每一頁轉成圖片", { exact: false })).toBeVisible({ timeout: 20000 });
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(sniff(file.data)).toBe("pdf");
  const again = await checkDocument(file.data, "pdf");
  expect(again).toEqual({ items: [], partial: undefined });
  expect(Buffer.from(file.data).includes("open.example.com")).toBe(false);
});

test("沒有問題的 PDF：說明沒有找到，也寫明檢查不到的情況", async ({ page }) => {
  await page.goto("./doc-check/");
  await page.getByTestId("file-input").setInputFiles({ name: "plain.pdf", mimeType: "application/pdf", buffer: Buffer.from(await cleanPdf()) });
  await expect(page.getByTestId("doc-check-verdict")).toContainText("沒有找到打開時會連線或執行的內容");
  await expect(page.getByText("沒有找到不等於一定安全", { exact: false })).toBeVisible();
});

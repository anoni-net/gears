import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { wav } from "../helpers/audio.ts";
import { syntheticDocx, syntheticPdf } from "../helpers/documents.ts";
import { PHISH_EML } from "../helpers/emails.ts";
import { incrementalPdf } from "../helpers/pdf-incremental.ts";
import { expect, test } from "./guard.ts";

// 用 axe-core 檢查 WCAG 2.1 AA。只在 Chromium 跑，結果跟瀏覽器無關
test.skip(({ browserName }) => browserName !== "chromium", "無障礙檢查只在 Chromium 執行");

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
}

for (const path of ["./", "./en/", "./qrcode/", "./url-check/", "./passphrase/", "./age-keygen/", "./text-crypt/", "./qr-read/", "./redact/", "./pdf-pages/", "./strip-metadata/", "./verify/", "./email-check/", "./writing-style/", "./licenses/", "./llm-bench/"]) {
  test(`${path} 沒有無障礙問題`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await audit(page)).toEqual([]);
  });
}

test("加入文件、清除之後的檔案畫面沒有無障礙問題", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles([
    { name: "a.docx", mimeType: "application/octet-stream", buffer: Buffer.from(await syntheticDocx()) },
    { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("x") },
  ]);
  await expect(page.getByText("檔案裡找到的資訊")).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test("逐字稿的編輯畫面沒有無障礙問題", async ({ page }) => {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "audio/wav", buffer: Buffer.from(wav(2)) });
  await expect(page.getByRole("button", { name: "開始轉逐字稿" })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  // 選了從 Hugging Face 下載的模型時出現的說明，深色模式也檢查
  await page.getByLabel(/^large-v3-turbo/).check();
  await expect(page.getByTestId("transcribe-remote")).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await audit(page)).toEqual([]);
});

test("PDF 的遮蔽畫面（換頁列）沒有無障礙問題", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(await syntheticPdf()) });
  await expect(page.getByTestId("redact-auto-status")).toContainText("自動尋找在你的瀏覽器裡執行", { timeout: 15000 });
  await expect(page.getByText(/第 1 頁，共 \d+ 頁/)).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test("選擇 PDF 頁面的畫面沒有無障礙問題", async ({ page }) => {
  await page.goto("./pdf-pages/");
  await page.getByTestId("file-input").setInputFiles({ name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(await syntheticPdf()) });
  await page.getByRole("checkbox", { name: "第 1 頁" }).check({ timeout: 15000 });
  expect(await audit(page)).toEqual([]);
  // 放大檢視的對話框
  await page.getByRole("button", { name: "放大第 1 頁" }).click();
  await expect(page.getByTestId("page-zoom-canvas")).not.toHaveClass(/waiting/, { timeout: 15000 });
  expect(await audit(page)).toEqual([]);
});

test("查證的畫面沒有無障礙問題", async ({ page }) => {
  await page.goto("./verify/");
  await page.getByTestId("verify-input").setInputFiles([
    { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from(await syntheticPdf()) },
    { name: "b.docx", mimeType: "application/octet-stream", buffer: Buffer.from(await syntheticDocx()) },
  ]);
  await expect(page.getByTestId("verify-hash")).toHaveCount(2, { timeout: 15000 });
  expect(await audit(page)).toEqual([]);
  // PDF 的版本紀錄與比對結果
  await page.getByTestId("verify-input").setInputFiles({ name: "c.pdf", mimeType: "application/pdf", buffer: Buffer.from((await incrementalPdf()).bytes) });
  await page.getByRole("button", { name: "跟第 2 版比對" }).click({ timeout: 15000 });
  await expect(page.getByText("第 1 頁：有變動")).toBeVisible({ timeout: 15000 });
  expect(await audit(page)).toEqual([]);
});

test("信件檢查的結果畫面沒有無障礙問題", async ({ page }) => {
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: "secure-login.example.com\n", contentType: "text/plain" }));
  await page.goto("./email-check/");
  await page.getByTestId("email-input").fill(PHISH_EML);
  await expect(page.getByTestId("email-verdict")).toBeVisible();
  await expect(page.getByText("在 165 清單上")).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await audit(page)).toEqual([]);
});

test("深色模式沒有對比問題", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./");
  expect(await audit(page)).toEqual([]);
});

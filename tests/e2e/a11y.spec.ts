import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { wav } from "../helpers/audio.ts";
import { syntheticDocx, syntheticPdf } from "../helpers/documents.ts";
import { PHISH_EML } from "../helpers/emails.ts";
import { incrementalPdf } from "../helpers/pdf-incremental.ts";
import { encodeQr, qrPng } from "../../src/tools/qrcode/index.ts";
import { existsSync, readFileSync } from "node:fs";
import { SCENES_WEBM } from "../global-setup.ts";
import { expect, test } from "./guard.ts";

// 用 axe-core 檢查 WCAG 2.1 AA。只在 Chromium 跑，結果跟瀏覽器無關
test.skip(({ browserName }) => browserName !== "chromium", "無障礙檢查只在 Chromium 執行");

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
}

for (const path of ["./", "./en/", "./qrcode/", "./url-check/", "./passphrase/", "./age-keygen/", "./text-crypt/", "./qr-read/", "./redact/", "./pdf-pages/", "./strip-metadata/", "./verify/", "./email-check/", "./writing-style/", "./video-frames/", "./nearby/", "./remote/", "./licenses/", "./bench/", "./feedback/", "./samples/", "./remote-server/", "./storage/", "./privacy/", "./testing/", "./about/", "./en/about/"]) {
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

test("QR code 產生器的聯絡資料與錯誤訊息、讀取的付款提醒沒有無障礙問題", async ({ page }) => {
  await page.goto("./qrcode/");
  await page.getByRole("radio", { name: "聯絡資料" }).check();
  await page.getByLabel("姓名").fill("陳小明");
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.getByLabel("電話號碼").fill("abc");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "pay.png", mimeType: "image/png", buffer: Buffer.from(qrPng(encodeQr("monero:4AdUnd?tx_amount=1", "M"), 6)) });
  await expect(page.getByTestId("qr-fields")).toContainText("Monero");
  expect(await audit(page)).toEqual([]);
  await page.getByTestId("sample-link").click();
  await page.locator('[data-sample="boarding-pdf417"]').click();
  await expect(page.getByTestId("qr-fields")).toContainText("登機證");
  expect(await audit(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await audit(page)).toEqual([]);
});

test("寫作習慣檢查的結果與線索清單沒有無障礙問題", async ({ page }) => {
  await page.goto("./writing-style/");
  await page.getByLabel("要交出去的文字").fill("老實說這個視頻很多啦😤 有事打 0912-345-678!!!");
  await expect(page.getByTestId("style-clues")).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
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
  await expect(page.getByTestId("redact-auto-status")).toContainText("側臉、戴口罩的臉", { timeout: 15000 });
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

test("影片的關鍵影格挑完畫面之後沒有無障礙問題", async ({ page }) => {
  test.skip(!existsSync(SCENES_WEBM), "沒有測試影片（需要 ffmpeg）");
  await page.goto("./video-frames/");
  await page.getByTestId("file-input").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: readFileSync(SCENES_WEBM) });
  await expect(page.getByTestId("frames-status")).toContainText(/挑出 \d+ 格/, { timeout: 60_000 });
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

// 工具以外的頁面的左欄（src/ui/PageAside.tsx）：暫存區有檔案、目前頁面的標示與本頁目錄，深淺色都檢查。
// 上面逐頁的檢查是暫存區沒有檔案、淺色的畫面
test("工具以外的頁面的左欄，暫存區有檔案時深淺色都沒有無障礙問題", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.locator(".tray .item")).toHaveCount(1);
  for (const id of ["licenses", "bench", "feedback", "samples", "remote-server", "storage", "privacy", "testing", "about"]) {
    await page.evaluate((id) => {
      history.pushState(null, "", `/gears/${id}/`);
      dispatchEvent(new Event("gears:navigate"));
    }, id);
    await expect(page.getByTestId("aside-tray")).toContainText("暫存區有 1 個檔案");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await audit(page), `${id} ${colorScheme}`).toEqual([]);
    }
  }
});

// 設計原則（src/ui/AboutPage.tsx）：模型表與即時檢查，寬螢幕與窄螢幕、深淺色都檢查
test("設計原則頁的模型表與即時檢查，深淺色都沒有無障礙問題", async ({ page }) => {
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./about/");
    await expect(page.getByTestId("about-status-gpu")).not.toHaveAttribute("data-state", "checking");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await audit(page), `${width} ${colorScheme}`).toEqual([]);
    }
  }
});

test("已下載的模型的持久儲存，申請之前與被拒絕之後深淺色都沒有無障礙問題", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, "persisted", { value: async () => false, configurable: true });
    Object.defineProperty(StorageManager.prototype, "persist", { value: async () => false, configurable: true });
  });
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./storage/");
    await expect(page.getByTestId("storage-persist")).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await audit(page), `${width} ${colorScheme}`).toEqual([]);
    }
    await page.getByTestId("storage-persist").click();
    await expect(page.getByTestId("storage-persist-status")).toContainText("瀏覽器沒有同意");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await audit(page), `${width} ${colorScheme} denied`).toEqual([]);
    }
  }
});

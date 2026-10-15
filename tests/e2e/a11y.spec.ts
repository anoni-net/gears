import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { syntheticDocx } from "../helpers/documents.ts";
import { expect, test } from "./guard.ts";

// 用 axe-core 檢查 WCAG 2.1 AA。只在 Chromium 跑，結果跟瀏覽器無關
test.skip(({ browserName }) => browserName !== "chromium", "無障礙檢查只在 Chromium 執行");

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
}

for (const path of ["./", "./en/", "./qrcode/", "./url-check/", "./passphrase/", "./age-keygen/", "./text-crypt/", "./qr-read/", "./redact/", "./strip-metadata/"]) {
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

test("深色模式沒有對比問題", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("./");
  expect(await audit(page)).toEqual([]);
});

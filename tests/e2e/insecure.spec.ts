import { decrypt } from "../../src/tools/age/index.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 測試跑在 localhost，瀏覽器把它當成安全的來源，有 crypto.subtle。用 HTTP 打開的頁面
// 沒有它，這裡把它拿掉，模擬那種情況：用到公鑰與私鑰的地方要說明，不能按了沒反應。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, "subtle", { get: () => undefined, configurable: true });
  });
});

test.setTimeout(90_000);

test("沒有 crypto.subtle：金鑰產生器說明需要 HTTPS，按鈕停用", async ({ page }) => {
  await page.goto("./age-keygen/");
  await expect(page.getByRole("alert")).toContainText("只有 https:// 開頭的網址才能使用");
  await expect(page.getByRole("button", { name: "產生一組金鑰" })).toBeDisabled();
});

test("沒有 crypto.subtle：用公鑰加密停用，用密語加密照常", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("button", { name: "開始加密" }).click();
  await page.getByLabel("對方的公鑰").check();
  await expect(page.getByText("只有 https:// 開頭的網址才能使用")).toBeVisible();
  await page.getByLabel("對方的 age 公鑰，一行一把").fill("age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p");
  await expect(page.getByRole("button", { name: "加密", exact: true })).toBeDisabled();

  await page.getByLabel("密語", { exact: true }).check();
  await page.getByLabel("加密用的密語").fill("correct horse battery staple");
  await page.getByRole("button", { name: "加密", exact: true }).click();
  await expect(page.getByTestId("history-current").getByText("加密", { exact: true })).toBeVisible({ timeout: 60_000 });
  const out = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(new TextDecoder().decode(await decrypt(out.data, "correct horse battery staple"))).toBe("hello");
});

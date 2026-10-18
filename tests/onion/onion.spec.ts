import { ONION_HOST } from "../../src/site.ts";
import { expect, test } from "../e2e/guard.ts";
import { wav } from "../helpers/audio.ts";

// guard 檢查每個測試都沒有連到網站以外的主機，主控台也沒有錯誤（CSP 擋下東西時會留下錯誤）

test("首頁在根目錄，頁尾連到 onion 的社群首頁，不記錄使用統計", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: /QR code 讀取/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "匿名網路社群 anoni.net" })).toHaveAttribute("href", `http://${ONION_HOST}/`);
  await expect(page.getByTestId("analytics")).toHaveText("onion 版不記錄使用統計。");
  // 建議與回饋送到 onion 的表單伺服器，CSP 只開那一個網址
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain(`connect-src 'self' http://form.${ONION_HOST}/api/v1/client/`);
  expect(csp).not.toContain("form.anoni.net");
});

test("工具的網址在根目錄底下，打開之後可以換工具", async ({ page }) => {
  await page.goto("./qr-read/");
  await expect(page).toHaveURL(/\/qr-read\/$/);
  await expect(page.getByTestId("qr-input")).toBeAttached();
  await page.goto("./en/url-check/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("社群轉檔的模型由同一個 onion 網站提供，轉檔紀錄也連到這裡", async ({ page }) => {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "application/octet-stream", buffer: Buffer.from(wav(2)) });
  const details = page.getByTestId("transcribe-models");
  await details.getByText("使用的模型與授權").click();
  await expect(details.locator('a[href="/models/assets/breeze-asr-25-cffe7cc/README.txt"]')).toHaveCount(1);
  await expect(details.locator('a[href*="assets.anoni.net"]')).toHaveCount(0);
  await expect(details).not.toContainText("assets.anoni.net");
  await expect(details).toContainText("下載：Hugging Face，選了這個模型才直接下載");
});

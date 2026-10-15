import { expect, test } from "./guard.ts";

// Playwright 只在 Chromium 支援 service worker 的離線測試
test.use({ serviceWorkers: "allow" });

test("第一次開啟之後，沒有網路也能開啟首頁與工具，產生 QR code", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
  await page.goto("./");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "隱私工作台" })).toBeVisible();
  // 直接打開某個工具的網址，以及沒存過的網址（改用首頁）
  await page.goto("./qrcode/");
  await expect(page).toHaveTitle(/QR code/);
  await page.getByLabel("要放進 QR code 的內容").fill("https://anoni.net/");
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toBeVisible();
  await page.goto("./no-such-page/");
  await expect(page.getByRole("heading", { name: "隱私工作台" })).toBeVisible();
  await context.setOffline(false);
});

test("service worker 只存工作台自己的檔案", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
  await page.goto("./");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("file-input").setInputFiles({ name: "secret.txt", mimeType: "text/plain", buffer: Buffer.from("SECRET-USER-FILE") });
  await expect(page.getByText("secret.txt").first()).toBeVisible();
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) urls.push(req.url);
    return urls;
  });
  expect(cached.length).toBeGreaterThan(10);
  expect(cached.every((u) => new URL(u).pathname.startsWith("/gears/"))).toBe(true);
  expect(cached.some((u) => u.startsWith("blob:") || u.includes("secret"))).toBe(false);
});

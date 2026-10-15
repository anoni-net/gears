import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
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
  // 人臉辨識的 WebAssembly 約 14 MB，用到時才存，第一次開啟不先下載
  expect(cached.some((u) => /\/assets\/ort-wasm-|\/models\/|\/vendor\//.test(u))).toBe(false);
});

test("第一次開啟時 service worker 接手頁面，不會重新載入、清掉暫存區", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
  await page.goto("./");
  // service worker 還在安裝時就放進檔案
  await page.getByTestId("file-input").setInputFiles({ name: "early.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.waitForTimeout(500);
  await expect(page.getByText("early.txt").first()).toBeVisible();
});

// 換版本的測試：瀏覽器檢查 service worker 有沒有更新的請求，page.route 攔不到，
// 所以自己起一個靜態伺服器提供 dist/，需要時換掉 sw.js 的內容
test.describe("換上新版本", () => {
  let server: Server;
  let port = 0;
  let sw: ((s: string) => string) | null = null;
  const dist = join(import.meta.dirname, "../../dist");
  const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".txt": "text/plain" };

  test.beforeAll(async () => {
    server = createServer(async (req, res) => {
      let path = decodeURIComponent(new URL(req.url!, "http://x").pathname).replace(/^\/gears/, "");
      if (path.endsWith("/")) path += "index.html";
      try {
        let body: Buffer | string = await readFile(join(dist, path));
        if (path === "/sw.js" && sw) body = sw(body.toString());
        res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  test.beforeEach(() => {
    sw = null;
  });
  test.use({ baseURL: async ({}, use) => use(`http://127.0.0.1:${port}/gears/`) });

  // 改掉 sw.js 的版本字串，瀏覽器就當成有新版本
  async function serveNewVersion(page: Page, version: string, edit = (s: string) => s) {
    sw = (s) => edit(s.replace(/const VERSION = "[^"]*"/, `const VERSION = "${version}"`));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  }

  test("有新版本時按重新載入，換上新版本並說明已經更新", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await serveNewVersion(page, "e2e-next");
    const reload = page.getByRole("button", { name: "重新載入" });
    await expect(reload).toBeVisible({ timeout: 30_000 });
    await reload.click();
    await expect(page.getByText("已換上新版本。")).toBeVisible({ timeout: 10_000 });
    await expect(reload).toBeHidden();
    // 舊版本的快取在新版本接手時刪掉
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(["gears-e2e-next"]);
    // 提示只出現在換版本的那一次，關掉之後不再出現
    await page.getByRole("button", { name: "關閉" }).click();
    await expect(page.getByText("已換上新版本。")).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("已換上新版本。")).toBeHidden();
  });

  test("新版本沒有接手時，按下重新載入一樣會重新載入，不會停在那裡", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    // 新版本收到訊息也不換上，模擬等著的那一版已經被取代、收不到 controllerchange 的情況
    await serveNewVersion(page, "e2e-stuck", (s) => s.replace("self.skipWaiting()", "void 0"));
    const reload = page.getByRole("button", { name: "重新載入" });
    await expect(reload).toBeVisible({ timeout: 30_000 });
    const loaded = page.waitForEvent("load", { timeout: 15_000 });
    await reload.click();
    await expect(page.getByRole("button", { name: "更新中…" })).toBeDisabled();
    await loaded;
  });
});

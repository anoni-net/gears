import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join } from "node:path";
import whisper from "../../src/tools/transcribe/models.json" with { type: "json" };
import { wav } from "../helpers/audio.ts";
import { expect, test } from "./guard.ts";

// Playwright 只在 Chromium 支援 service worker 的離線測試
test.use({ serviceWorkers: "allow" });

test("第一次開啟之後，沒有網路也能開啟首頁與工具，產生 QR code", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
  await page.goto("./");
  await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "檔案工作台" })).toBeVisible();
  // 直接打開某個工具的網址，以及沒存過的網址（改用首頁）
  await page.goto("./qrcode/");
  await expect(page).toHaveTitle(/QR code/);
  await page.getByLabel("要放進 QR code 的內容").fill("https://anoni.net/");
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toBeVisible();
  await page.goto("./no-such-page/");
  await expect(page.getByRole("heading", { name: "檔案工作台" })).toBeVisible();
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
// 所以自己起一個靜態伺服器提供 dist/，需要時換掉 sw.js 的內容。不靠 page.route，所以暫存區帶到新版本的流程
// 在 WebKit、Firefox 與 iPhone 尺寸也跑，三種瀏覽器核心都要能把檔案交給 service worker 暫放
test.describe("換上新版本", () => {
  let server: Server;
  let port = 0;
  let sw: ((s: string) => string) | null = null;
  // 模型的請求先擋著不回應，讓逐字稿停在下載模型的階段
  let holdModels = false;
  const held: import("node:http").ServerResponse[] = [];
  const dist = join(import.meta.dirname, "../../dist");
  const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".txt": "text/plain" };

  test.beforeAll(async () => {
    server = createServer(async (req, res) => {
      let path = decodeURIComponent(new URL(req.url!, "http://x").pathname).replace(/^\/gears/, "");
      if (path.endsWith("/")) path += "index.html";
      if (holdModels && path.startsWith("/models/whisper/")) return void held.push(res);
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
    holdModels = false;
  });
  // 擋著的請求在測試結束時回應掉，伺服器才關得掉
  test.afterEach(() => {
    for (const res of held.splice(0)) res.writeHead(503).end();
  });
  test.use({ baseURL: async ({}, use) => use(`http://127.0.0.1:${port}/gears/`) });

  // 暫存區有檔案時才出現換版本的提示，空的時候自動換（讀者還沒操作過就直接換，已經在操作的等分頁切到背景）
  async function addFile(page: Page, name = "keep.txt", body = "KEEP-ME") {
    await page.getByTestId("file-input").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(body) });
    await expect(page.getByText(name).first()).toBeVisible();
  }

  // 改掉 sw.js 的版本字串，瀏覽器就當成有新版本
  async function serveNewVersion(page: Page, version: string, edit = (s: string) => s) {
    sw = (s) => edit(s.replace(/const VERSION = "[^"]*"/, `const VERSION = "${version}"`));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  }

  test("有新版本時按重新載入，換上新版本，暫存區的檔案都帶過去，選取的檔案不變", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await addFile(page, "first.txt", "FIRST");
    await addFile(page, "second.txt", "SECOND");
    await page.getByRole("button", { name: /^first\.txt/ }).click();
    await serveNewVersion(page, "e2e-next");
    await expect(page.getByText("重新載入之後，暫存區的檔案會留著，還沒套用或下載的結果會消失。")).toBeVisible({ timeout: 30_000 });
    const reload = page.getByRole("button", { name: "重新載入" });
    await reload.click();
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}），暫存區的檔案都還在。$/)).toBeVisible({ timeout: 10_000 });
    await expect(reload).toBeHidden();
    // 兩個檔案都在，選取的還是 first.txt，內容沒變
    await expect(page.locator(".tray li")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "first.txt" })).toBeVisible();
    // 新版本暫放完就放掉，再拿一次是空的
    expect(await page.evaluate(() => new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => resolve(e.data.tray);
      navigator.serviceWorker.controller!.postMessage({ type: "take" }, [channel.port2]);
    }))).toBeNull();
    // 舊版本的快取在新版本接手時刪掉，暫存區的檔案也沒有寫進任何快取
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(["gears-e2e-next"]);
    const cached = await page.evaluate(async () => (await (await caches.open("gears-e2e-next")).keys()).map((r) => r.url));
    expect(cached.some((u) => u.includes("first") || u.startsWith("blob:"))).toBe(false);
    // 換上之後加入的檔案編號接著走，不會跟帶過來的撞號
    await addFile(page, "third.txt", "THIRD");
    await expect(page.locator(".tray li")).toHaveCount(3);
    // 提示只出現在換版本的那一次，關掉之後不再出現
    await page.getByRole("button", { name: "關閉" }).click();
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}），暫存區的檔案都還在。$/)).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/已換上新版本/)).toBeHidden();
  });

  test("暫存區是空的、讀者還沒操作過：新版本裝好就直接換上，顯示已換上新版本", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    const loaded = page.waitForEvent("load", { timeout: 30_000 });
    await serveNewVersion(page, "e2e-fresh");
    await loaded;
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(["gears-e2e-fresh"]);
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}）。$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "重新載入" })).toBeHidden();
  });

  test("暫存區是空的、讀者已經在操作：不出現提示，分頁切到背景才換，回來時顯示已換上新版本", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    // 讀者點過頁面
    await page.getByRole("heading", { name: "暫存區" }).click();
    await serveNewVersion(page, "e2e-idle");
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: "重新載入" })).toBeHidden();
    expect(await page.evaluate(() => caches.keys())).not.toEqual(["gears-e2e-idle"]);
    const loaded = page.waitForEvent("load", { timeout: 15_000 });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await loaded;
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(["gears-e2e-idle"]);
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}）。$/)).toBeVisible({ timeout: 10_000 });
  });

  test("分頁切回前景時檢查新版本，不必重新整理", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await addFile(page);
    // 只換掉伺服器上的 sw.js，不呼叫 update()，靠切回前景時的檢查發現
    sw = (s) => s.replace(/const VERSION = "[^"]*"/, 'const VERSION = "e2e-visible"');
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("button", { name: "重新載入" })).toBeVisible({ timeout: 30_000 });
  });

  test("從空白開始的工具畫面上有輸入的內容，暫存區是空的也不自動換", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
    await page.goto("./passphrase/");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await serveNewVersion(page, "e2e-busy");
    await expect(page.getByRole("button", { name: "重新載入" })).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => caches.keys())).not.toEqual(["gears-e2e-busy"]);
  });

  test("轉逐字稿的途中不出現換版本的提示，停下來之後才出現", async ({ page }) => {
    await page.goto("./transcribe/");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "audio/wav", buffer: Buffer.from(wav(2)) });
    await page.getByLabel(/^base：比較快/).check();
    holdModels = true;
    await page.getByRole("button", { name: "開始轉逐字稿" }).click();
    await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
    await serveNewVersion(page, "e2e-working");
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: "重新載入" })).toBeHidden();
    await page.getByRole("button", { name: "停止" }).click();
    await expect(page.getByRole("button", { name: "重新載入" })).toBeVisible();
  });

  test("新版本沒辦法暫放暫存區時不重新載入，請讀者先下載", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await addFile(page);
    // 新版本收到暫放的訊息不回應
    await serveNewVersion(page, "e2e-nohold", (s) => s.replace('data?.type === "hold"', "false"));
    await page.getByRole("button", { name: "重新載入" }).click();
    await expect(page.getByText("沒辦法把暫存區的檔案帶到新版本。", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("keep.txt").first()).toBeVisible();
    // 讀者決定照樣重新載入，暫存區清空
    const loaded = page.waitForEvent("load", { timeout: 15_000 });
    await page.getByRole("button", { name: "重新載入" }).click();
    await loaded;
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}）。$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("keep.txt")).toHaveCount(0);
  });

  test("逐字稿的模型換版本時留著，模型清單以外的舊版本刪掉", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    const current = `/gears/models/whisper/${whisper.base.dir}/config.json`;
    const old = "/gears/models/whisper/whisper-base-0000000/config.json";
    await page.evaluate(async (urls) => {
      const cache = await caches.open("gears-models");
      for (const url of urls) await cache.put(url, new Response("{}"));
    }, [current, old]);
    await addFile(page);
    await serveNewVersion(page, "e2e-models");
    await page.getByRole("button", { name: "重新載入" }).click();
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}），暫存區的檔案都還在。$/)).toBeVisible({ timeout: 10_000 });
    const kept = () => page.evaluate(async () => (await (await caches.open("gears-models")).keys()).map((r) => new URL(r.url).pathname));
    await expect.poll(kept).toEqual([current]);
    expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(["gears-e2e-models", "gears-models"]));
  });

  test("遮蔽的辨識模型換版本時留著，內容變了或不在清單上的才刪掉", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "離線測試只在 Chromium 執行");
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    // 經過 service worker 取一次人臉模型，存進 gears-keep，回應帶著內容的雜湊
    const yunet = "/gears/models/yunet-2023mar-dynamic.onnx";
    await page.evaluate((url) => fetch(url).then((r) => r.arrayBuffer()), yunet);
    const kept = () =>
      page.evaluate(async () => {
        const cache = await caches.open("gears-keep");
        return Promise.all((await cache.keys()).map(async (r) => [new URL(r.url).pathname, (await cache.match(r))!.headers.get("x-gears-hash")]));
      });
    await expect.poll(async () => (await kept()).map(([path]) => path)).toEqual([yunet]);
    expect((await kept())[0]![1]).toMatch(/^[0-9a-f]{16}$/);
    // 內容換過的檔案（雜湊對不上）與已經不在清單上的檔案
    await page.evaluate(async () => {
      const cache = await caches.open("gears-keep");
      await cache.put("/gears/vendor/tesseract/worker.min.js", new Response("old", { headers: { "x-gears-hash": "0000000000000000" } }));
      await cache.put("/gears/assets/ort-wasm-simd-threaded-OLD.wasm", new Response("old", { headers: { "x-gears-hash": "1111111111111111" } }));
    });
    await addFile(page);
    await serveNewVersion(page, "e2e-keep");
    await page.getByRole("button", { name: "重新載入" }).click();
    await expect(page.getByText(/^已換上新版本（\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}），暫存區的檔案都還在。$/)).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await kept()).map(([path]) => path)).toEqual([yunet]);
    expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(["gears-e2e-keep", "gears-keep"]));
    // 留著的那份不必再連網
    await context.setOffline(true);
    expect(await page.evaluate((url) => fetch(url).then((r) => r.arrayBuffer()).then((b) => b.byteLength), yunet)).toBeGreaterThan(100_000);
    await context.setOffline(false);
  });

  test("新版本沒有接手時，按下重新載入一樣會重新載入，不會停在那裡", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await addFile(page);
    // 新版本收到訊息也不換上，模擬等著的那一版已經被取代、收不到 controllerchange 的情況
    await serveNewVersion(page, "e2e-stuck", (s) => s.replace("self.skipWaiting()", "void 0"));
    const reload = page.getByRole("button", { name: "重新載入" });
    await expect(reload).toBeVisible({ timeout: 30_000 });
    const loaded = page.waitForEvent("load", { timeout: 15_000 });
    await reload.click();
    await expect(page.getByRole("button", { name: "更新中…" })).toBeDisabled();
    await loaded;
    // 舊版本仍在接手，暫存區交給它暫放，一樣帶過來
    await expect(page.getByText("keep.txt").first()).toBeVisible({ timeout: 10_000 });
  });
});

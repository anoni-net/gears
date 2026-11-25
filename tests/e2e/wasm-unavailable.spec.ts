import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { GENERATED } from "../global-setup.ts";
import { wav } from "../helpers/audio.ts";
import { textPdf } from "../helpers/text-pdf.ts";
import { similarImage } from "../helpers/similar.ts";
import { expect, test } from "./guard.ts";

// iPhone、iPad 與 Mac 的鎖定模式會關掉 WebAssembly（src/ui/wasm.ts）。這裡把頁面的 WebAssembly
// 拿掉來模擬：用得到的功能要直接說明原因，不下載模型、不顯示「記憶體不夠」這類錯誤的原因
async function noWasm(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "WebAssembly", { value: undefined, configurable: true });
  });
}

test.beforeEach(async ({ page }) => {
  await noWasm(page);
});

test("桌面：裝置狀況那一行說明關掉了 WebAssembly，標著大腦圖示的工具不能用模型", async ({ page }) => {
  await page.goto("./");
  const device = page.getByTestId("desk-device");
  await expect(device).toContainText("鎖定模式");
  await expect(device).toContainText("其他功能照常使用");
});

test("逐字稿：一打開就說明這個瀏覽器關掉了 WebAssembly，開始的按鈕不能按", async ({ page }) => {
  const models: string[] = [];
  page.on("request", (r) => r.url().includes("/models/") && models.push(r.url()));
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "application/octet-stream", buffer: Buffer.from(wav(2)) });
  await expect(page.getByTestId("transcribe-nowasm")).toContainText("鎖定模式");
  await expect(page.getByRole("button", { name: "開始轉逐字稿" })).toBeDisabled();
  expect(models).toEqual([]);
});

test("遮蔽：自動尋找說明原因，請讀者手動框選", async ({ page }) => {
  await page.goto("./");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    c.getContext("2d")!.fillRect(40, 40, 120, 60);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  // 桌面的工具連結只換到工具頁，選檔案由讀者在工具頁按下（不自動打開系統的選檔案視窗）
  await page.getByRole("link", { name: /截圖上的名字與電話/ }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".intro").getByRole("button", { name: "選擇檔案" }).click()]);
  await chooser.setFiles({ name: "chat.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await page.getByRole("button", { name: "找人臉" }).click();
  await expect(page.getByTestId("redact-auto-status")).toContainText("需要的程式（WebAssembly）");
  await expect(page.getByTestId("redact-auto-status")).toContainText("請手動框選");
});

test("遮蔽：找人名、地址與單位也說明原因，不下載模型", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => r.url().includes("nym-pii") && asked.push(r.url()));
  await page.goto("./");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    c.getContext("2d")!.fillRect(40, 40, 120, 60);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  // 桌面的工具連結只換到工具頁，選檔案由讀者在工具頁按下（不自動打開系統的選檔案視窗）
  await page.getByRole("link", { name: /截圖上的名字與電話/ }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".intro").getByRole("button", { name: "選擇檔案" }).click()]);
  await chooser.setFiles({ name: "chat.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  await expect(page.getByTestId("redact-auto-status")).toContainText("需要的程式（WebAssembly）");
  expect(asked).toEqual([]);
});

test("HEIC：瀏覽器不能直接顯示又沒有 WebAssembly 時，說明載入不了解碼器", async ({ page, browserName }) => {
  // Safari（WebKit）本來就能解 HEIC，用不到 libheif
  test.skip(browserName === "webkit", "WebKit 內建 HEIC 解碼");
  test.skip(!existsSync(`${GENERATED}/photo.heic`), "沒有 HEIC 測試檔（需要 pillow-heif）");
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: readFileSync(`${GENERATED}/photo.heic`) });
  await expect(page.locator(".preview")).toContainText("又關掉了另外開啟它需要的程式（WebAssembly");
});

test("QR code 與條碼讀取：說明只能讀 QR code，QR code 照樣讀得出來", async ({ page }) => {
  const { encodeQr, qrPng } = await import("../../src/tools/qrcode/index.ts");
  await page.goto("./qr-read/");
  await expect(page.getByText("目前只能讀 QR code，讀不了登機證、商品條碼這類其他條碼", { exact: false })).toBeVisible();
  await page.getByTestId("qr-input").setInputFiles({ name: "q.png", mimeType: "image/png", buffer: Buffer.from(qrPng(encodeQr("https://anoni.net/", "M"), 6)) });
  await expect(page.getByTestId("qr-text")).toHaveText("https://anoni.net/");
});

test("遮蔽 PDF：有文字層時不必辨識，照樣找得到個資", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "contact.pdf", mimeType: "application/pdf", buffer: await textPdf() });
  await expect(page.getByText("第 1 頁，共 1 頁")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("redact-auto-status")).toContainText("側臉、戴口罩的臉", { timeout: 15000 });
  await page.getByRole("button", { name: "找電話、Email 等個資" }).click();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("加了 2 個框，請逐一確認，框錯的點一下就會拿掉。");
  // 找人臉一定要 WebAssembly
  await page.getByRole("button", { name: "找人臉" }).click();
  await expect(page.getByTestId("redact-auto-status")).toContainText("需要的程式（WebAssembly）");
});

test("檢查畫面內容：說明這個瀏覽器關掉了 WebAssembly，請讀者自己看一次", async ({ page }) => {
  await page.goto("./");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    c.getContext("2d")!.fillRect(40, 40, 120, 60);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId("file-input").setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  const status = page.getByTestId("screen-status");
  await expect(status).toContainText("需要的程式（WebAssembly）");
  await expect(status).toContainText("請自己看一次整張圖");
  await expect(status).toHaveClass("error");
});

test("網址檢查：從截圖讀出網址說明關掉了 WebAssembly，不打開選檔案的視窗、不下載模型", async ({ page }) => {
  const models: string[] = [];
  page.on("request", (r) => r.url().includes("/models/") && models.push(r.url()));
  let chooser = false;
  page.on("filechooser", () => (chooser = true));
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: "# count=0\n", contentType: "text/plain" }));
  await page.goto("./url-check/");
  await page.getByRole("button", { name: "從截圖讀出網址" }).click();
  const status = page.getByTestId("url-ocr-status");
  await expect(status).toContainText("需要的程式（WebAssembly）");
  await expect(status).toContainText("打進上面的輸入框");
  await expect(status).toHaveClass("error");
  expect(chooser).toBe(false);
  expect(models).toEqual([]);
  // 不用截圖照樣可以檢查
  await page.getByLabel("要檢查的網址").fill("https://example.com/?utm_source=x");
  await expect(page.getByTestId("clean-url")).toHaveText("https://example.com/");
});

test("查證的相近的圖片：不用模型的比對照常分組，模型的選項說明為什麼不能用", async ({ page }) => {
  const models: string[] = [];
  page.on("request", (r) => r.url().includes("/models/") && models.push(r.url()));
  await page.goto("./verify/");
  await page.getByTestId("verify-input").setInputFiles([
    { name: "photo.jpg", mimeType: "image/jpeg", buffer: await similarImage(page, "orig") },
    { name: "photo-flip.png", mimeType: "image/png", buffer: await similarImage(page, "flip") },
  ]);
  await expect(page.getByTestId("similar-group")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("similar-nowasm")).toContainText("鎖定模式");
  await expect(page.getByRole("button", { name: "也比對裁切、加字之後的版本" })).toHaveCount(0);
  expect(models).toEqual([]);
});

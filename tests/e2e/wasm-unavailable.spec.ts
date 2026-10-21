import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { GENERATED } from "../global-setup.ts";
import { wav } from "../helpers/audio.ts";
import { textPdf } from "../helpers/text-pdf.ts";
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
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /截圖上的名字與電話/ }).click()]);
  await chooser.setFiles({ name: "chat.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await page.getByRole("button", { name: "找人臉" }).click();
  await expect(page.getByTestId("redact-auto-status")).toContainText("關掉了 WebAssembly");
  await expect(page.getByTestId("redact-auto-status")).toContainText("請手動框選");
});

test("HEIC：瀏覽器不能直接顯示又沒有 WebAssembly 時，說明載入不了解碼器", async ({ page, browserName }) => {
  // Safari（WebKit）本來就能解 HEIC，用不到 libheif
  test.skip(browserName === "webkit", "WebKit 內建 HEIC 解碼");
  test.skip(!existsSync(`${GENERATED}/photo.heic`), "沒有 HEIC 測試檔（需要 pillow-heif）");
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: readFileSync(`${GENERATED}/photo.heic`) });
  await expect(page.locator(".preview")).toContainText("又關掉了 WebAssembly");
});

test("QR code 與條碼讀取：說明只能讀 QR code，QR code 照樣讀得出來", async ({ page }) => {
  const { encodeQr, qrPng } = await import("../../src/tools/qrcode/index.ts");
  await page.goto("./qr-read/");
  await expect(page.getByText("只能讀 QR code，讀不了登機證與商品條碼")).toBeVisible();
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
  await expect(page.getByTestId("redact-auto-status")).toContainText("關掉了 WebAssembly");
});

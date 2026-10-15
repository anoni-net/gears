import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import models from "../../src/tools/transcribe/models.json" with { type: "json" };
import { wav } from "../helpers/audio.ts";
import { syntheticMp4 } from "../helpers/media.ts";
import { expect, test } from "./guard.ts";

// 模型很大，不進 repo，要先執行 node scripts/fetch-whisper.mjs base（CI 會先下載 base）
const BASE_MODEL = join(import.meta.dirname, "../../public/models/whisper", models.base.dir, "onnx/decoder_model_merged_quantized.onnx");
const hasModel = existsSync(BASE_MODEL);

async function open(page: Page, name: string, data: Uint8Array) {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(data) });
  await expect(page.getByRole("button", { name: "開始轉逐字稿" })).toBeVisible();
}

test("選了錄音之後列出兩個模型與下載大小，可以選核心數", async ({ page }) => {
  await open(page, "talk.wav", wav(2));
  await expect(page.getByLabel(/^small：準確度較好/)).toBeChecked();
  await expect(page.getByText(`下載約 ${Math.round(models.small.bytes / 1e6)} MB`)).toBeVisible();
  await expect(page.getByText(`下載約 ${Math.round(models.base.bytes / 1e6)} MB`)).toBeVisible();
  await expect(page.getByText(/第一次使用要下載模型/)).toBeVisible();
  // 預覽伺服器送了 COOP 與 COEP，可以用多個核心
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await page.getByLabel("2", { exact: true }).check();
  await expect(page.getByLabel("2", { exact: true })).toBeChecked();
});

test("瀏覽器讀不了聲音的檔案，說明原因，不下載模型", async ({ page }) => {
  const models: string[] = [];
  page.on("request", (r) => r.url().includes("/models/whisper/") && models.push(r.url()));
  // 結構完整、但影音資料是假的 MP4：暫存區認得，瀏覽器解不出聲音
  await open(page, "clip.mp4", syntheticMp4());
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("目前的瀏覽器無法讀取這個檔案的聲音，請換成 MP3、M4A 或 WAV 再試一次。");
  expect(models).toEqual([]);
});

test("靜音的錄音不送進模型，說明沒有辨識到說話的內容", async ({ page }) => {
  test.skip(!hasModel, "沒有下載 base 模型");
  // 跟其他測試平行執行時 CPU 很忙，用 1 個核心，也涵蓋單執行緒的路徑（多執行緒由下面
  // 離線快取的測試涵蓋）。Firefox 同時開好幾個執行緒池時，建立推論環境會慢到逾時
  test.setTimeout(240_000);
  await open(page, "silence.wav", wav(5));
  await page.getByLabel(/^base：比較快/).check();
  await page.getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
});

test.describe("離線快取", () => {
  test.use({ serviceWorkers: "allow" });

  test("模型存進不隨版本清掉的快取，可以刪除", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "service worker 的測試只在 Chromium 執行");
    test.skip(!hasModel, "沒有下載 base 模型");
    test.setTimeout(120_000);
    await page.goto("./transcribe/");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.getByTestId("file-input").setInputFiles({ name: "silence.wav", mimeType: "audio/wav", buffer: Buffer.from(wav(5)) });
    await page.getByLabel(/^base：比較快/).check();
    await page.getByRole("button", { name: "開始轉逐字稿" }).click();
    await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 90_000 });
    const cached = () => page.evaluate(async () => (await (await caches.open("gears-models")).keys()).map((r) => new URL(r.url).pathname));
    await expect.poll(async () => (await cached()).length).toBe(Object.keys(models.base.files).length);
    expect((await cached()).every((p) => p.startsWith(`/gears/models/whisper/${models.base.dir}/`))).toBe(true);
    await expect(page.getByText("已下載", { exact: true })).toBeVisible();
    // small 也下載過的話，刪 base 時要留著
    const small = `/gears/models/whisper/${models.small.dir}/config.json`;
    await page.evaluate((url) => caches.open("gears-models").then((c) => c.put(url, new Response("{}"))), small);
    await page.getByRole("button", { name: `刪除已下載的 base 模型（${Math.round(models.base.bytes / 1e6)} MB）` }).click();
    await expect(page.getByTestId("transcribe-status")).toHaveText("已刪除下載的 base 模型，其他模型不受影響。");
    expect(await cached()).toEqual([small]);
  });
});

import type { Page } from "@playwright/test";
import whisper from "../../src/tools/transcribe/models.json" with { type: "json" };
import { expect, test } from "./guard.ts";

// 在三個快取裡各放幾個假的檔案，大小由內容的位元組數決定
const ENTRIES: [cache: string, url: string, bytes: number][] = [
  ["gears-models", `/gears/models/whisper/${whisper.base.dir}/onnx/encoder_model_quantized.onnx`, 2_000_000],
  ["gears-keep", "/gears/models/yunet-2023mar-dynamic.onnx", 230_000],
  ["gears-keep", "/gears/models/ppocr/PP-OCRv5_mobile_rec.onnx", 3_000_000],
  ["transformers-cache", "https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/abc/onnx/model.onnx", 1_500_000],
];

async function seed(page: Page) {
  await page.evaluate(async (entries) => {
    for (const [name, url, bytes] of entries) await (await caches.open(name)).put(url, new Response(new Uint8Array(bytes)));
  }, ENTRIES);
}

const stored = (page: Page) =>
  page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of ["gears-models", "gears-keep", "transformers-cache"]) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
    return urls.sort();
  });

test("已下載的模型：依用途列出大小，可以逐列刪除與全部刪除", async ({ page }) => {
  await page.goto("./");
  await seed(page);
  await page.getByRole("button", { name: "已下載的模型" }).click();
  await expect(page.getByRole("heading", { name: "已下載的模型" })).toBeVisible();
  const rows = page.getByTestId("storage-list").locator("li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("base：比較快");
  await expect(rows.nth(0)).toContainText("2 MB");
  await expect(rows.nth(1)).toContainText("找人臉的模型");
  await expect(rows.nth(1)).toContainText("230 KB");
  await expect(rows.nth(2)).toContainText("辨識文字的模型");
  await expect(rows.nth(3)).toContainText("語言模型速度量測的模型");
  await expect(page.getByText("合計 7 MB")).toBeVisible();

  await page.getByRole("button", { name: "刪除找人臉的模型" }).click();
  await expect(page.getByTestId("storage-status")).toHaveText("刪除了找人臉的模型，下次用到時再下載。");
  await expect(rows).toHaveCount(3);
  expect(await stored(page)).not.toContain("/gears/models/yunet-2023mar-dynamic.onnx");

  await page.getByRole("button", { name: "全部刪除" }).click();
  await expect(page.getByTestId("storage-empty")).toBeVisible();
  expect(await stored(page)).toEqual([]);
});

test("已下載的模型：不能用 Cache API 時說明", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "caches", { value: undefined, configurable: true });
  });
  await page.goto("./storage/");
  await expect(page.getByTestId("storage-unavailable")).toContainText("私密瀏覽");
});

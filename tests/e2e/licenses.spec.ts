import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import models from "../../src/tools/transcribe/models.json" with { type: "json" };
import { wav } from "../helpers/audio.ts";
import { expect, test } from "./guard.ts";

// 授權與來源（src/ui/Licenses.tsx）：從頁尾進入、直接用網址打開，授權全文跟著建置一起輸出

const licenses = ["transcribe", "redact-detect", "pdfjs", "pdf-lib", "libheif", "openpgp", "c2pa", "pkijs", "zxing", "material-design-icons"];

test("從頁尾打開授權與來源，每份授權全文都下載得到、內容跟 licenses/ 相同", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "授權與來源" }).click();
  await expect(page).toHaveURL(/\/gears\/licenses\/$/);
  await expect(page.getByRole("heading", { name: "授權與來源" })).toBeVisible();
  const links = page.getByTestId("licenses").getByRole("link", { name: "授權全文" });
  await expect(links).toHaveCount(licenses.length);
  for (const [i, name] of licenses.entries()) {
    const href = await links.nth(i).getAttribute("href");
    const text = await page.evaluate(async (url) => (await fetch(url!)).text(), href);
    expect(text, name).toBe(readFileSync(join(import.meta.dirname, "../../licenses", `${name}.txt`), "utf8"));
  }
  // 工作台自己的授權直接展開在頁面上
  await page.getByTestId("licenses").locator("summary").click();
  await expect(page.getByText(/^MIT License/)).toBeVisible();
});

test("建置產物裡每個語系都有授權頁的 HTML", ({ browserName }) => {
  // 預覽伺服器遇到不存在的路徑會回首頁，正式站的 nginx 不會，直接開網址的測試抓不到漏產的頁面。
  // 只看建置產物，一種瀏覽器檢查一次就夠
  test.skip(browserName !== "chromium");
  for (const prefix of ["", "zh-cn/", "en/"]) {
    expect(existsSync(join(import.meta.dirname, "../../dist", prefix, "licenses/index.html")), prefix || "zh-TW").toBe(true);
  }
});

test("直接打開英文版的授權頁", async ({ page }) => {
  await page.goto("./en/licenses/");
  await expect(page.getByRole("heading", { name: "Licenses and sources" })).toBeVisible();
  await expect(page).toHaveTitle("Licenses and sources | Gears");
  await expect(page.getByRole("heading", { name: "Tray" })).toHaveCount(0);
});

test("逐字稿列出每個模型的原始來源、授權與下載的位置", async ({ page }) => {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "application/octet-stream", buffer: Buffer.from(wav(2)) });
  const details = page.getByTestId("transcribe-models");
  await details.getByText("使用的模型與授權").click();
  for (const info of Object.values(models)) {
    await expect(details.locator(`a[href="${info.source}"]`)).toHaveCount(1);
  }
  // 轉檔的人分三種：onnx-community 與 sherpa-onnx 轉好的連到原本的 repo，社群自己轉的連到轉檔紀錄
  await expect(details.locator('a[href="https://huggingface.co/onnx-community/whisper-small"]')).toHaveCount(1);
  await expect(details.locator('a[href^="https://huggingface.co/csukuangfj/sherpa-onnx-omnilingual"]')).toHaveCount(1);
  await expect(details.locator('a[href="https://assets.anoni.net/gears/models/breeze-asr-25-cffe7cc/README.txt"]')).toHaveCount(1);
  await expect(details.locator('a[href^="https://assets.anoni.net/gears/models/omnilingual"]')).toHaveCount(0);
  await expect(details).toContainText("下載：Hugging Face，選了這個模型才直接下載");
  await expect(details).toContainText("下載：anoni.net，跟工作台同一個網站");
  await details.getByRole("button", { name: "所有授權全文" }).click();
  await expect(page).toHaveURL(/\/gears\/licenses\/$/);
});

test("頁尾顯示版本號，commit 連到原始碼的那一次修改", async ({ page }) => {
  await page.goto("./");
  const version = page.getByTestId("version");
  await expect(version).toHaveText(/^版本 \d{4}\.\d{2}\.\d{2} \d{2}:\d{2} [0-9a-f]{7,}$/);
  await expect(version.getByRole("link")).toHaveAttribute("href", /^https:\/\/github\.com\/anoni-net\/gears\/commit\/[0-9a-f]{7,}$/);
});

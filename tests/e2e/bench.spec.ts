import models from "../../src/tools/llm-bench/models.json" with { type: "json" };
import { assetsUrl } from "../../src/core/models.ts";
import { PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import { expect, test } from "./guard.ts";

test("裝置量測：實驗頁說明下載來源，不進 sitemap，搜尋引擎不收錄", async ({ page, request }) => {
  await page.goto("./bench/");
  await expect(page.getByRole("heading", { name: "裝置量測", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "文字辨識" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "語言模型" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "個資辨識" })).toBeVisible();
  await expect(page.getByTestId("bench-pii-remote")).toContainText("從社群的 assets.anoni.net 下載");
  await expect(page.getByTestId("bench-remote")).toContainText("Hugging Face 看得到你的 IP 位址");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  // localhost 算安全的連線，不出現要用 HTTPS 的說明
  await expect(page.getByTestId("bench-insecure")).toHaveCount(0);
  for (const info of Object.values(models)) await expect(page.getByLabel(new RegExp(`^${info.name.replace(".", "\\.")}`))).toBeVisible();
  // 還沒量測時沒有結果可以複製
  await expect(page.getByRole("button", { name: "複製結果" })).toBeDisabled();
  // 入口在桌面最下面的使用者區，頁尾沒有
  await page.goto("./");
  await expect(page.locator("footer").getByRole("link", { name: "裝置量測（實驗）" })).toHaveCount(0);
  await page.getByRole("list", { name: "使用者區" }).getByRole("link", { name: "裝置量測（實驗）" }).click();
  await expect(page).toHaveURL(/\/gears\/bench\/$/);
  await expect(page.getByRole("heading", { name: "裝置量測", level: 1 })).toBeVisible();

  const html = await (await request.get("./bench/")).text();
  expect(html).toContain('<meta name="robots" content="noindex" />');
  const sitemap = await (await request.get("./sitemap.xml")).text();
  expect(sitemap).toContain("/gears/licenses/");
  expect(sitemap).not.toContain("bench");
});

test("裝置量測：舊網址 /llm-bench/ 不轉址，是找不到的頁面", async ({ page }) => {
  await page.goto("./llm-bench/");
  await expect(page.getByRole("heading", { name: "找不到這一頁" })).toBeVisible();
  await expect(page).toHaveURL(/\/gears\/llm-bench\/$/);
});

test("裝置量測：文字辨識用範例截圖量出時間與字錯率，結果的 JSON 不含自己輸入的文字", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./bench/");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  // 只量 1 個執行緒，CI 的機器只有 4 核心
  // 個資辨識也有同樣的選項，只在文字辨識那一區裡找
  const ocr = page.locator('section[aria-labelledby="bench-ocr-title"]');
  for (const label of ["CPU，4 個執行緒", "CPU，8 個執行緒"]) {
    const box = ocr.getByLabel(label);
    if (await box.isChecked()) await box.uncheck();
  }
  const gpu = page.getByLabel("顯示卡", { exact: true }).first();
  if ((await gpu.isEnabled()) && (await gpu.isChecked())) await gpu.uncheck();
  // 語言模型的自訂文字不會出現在結果裡（這裡沒有量語言模型，只確認不會被帶進來）
  await page.getByLabel("自己的文字（選填）").fill("祕密的段落 0912-345-678");
  await page.getByRole("button", { name: "量測文字辨識" }).click();
  await expect(page.getByTestId("bench-ocr-status")).toHaveText("文字辨識量測完成。", { timeout: 90_000 });

  const row = page.getByTestId("bench-ocr-table").locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("CPU，1 個執行緒");
  const rate = Number((await row.locator("td").last().textContent())!.replace("%", ""));
  // #140 的評測裡 PP-OCRv5 在合成截圖的字錯率約 4%，三張範例都是清楚的截圖
  expect(rate).toBeLessThan(10);

  await page.getByText("看複製的內容", { exact: true }).click();
  const report = JSON.parse((await page.getByTestId("bench-report").textContent())!);
  expect(report.schema).toBe(2);
  expect(report.env.canvas).toBe(true);
  expect(report.ocr).toHaveLength(1);
  expect(report.ocr[0]).toMatchObject({ threads: 1, webgpu: false });
  for (const id of ["phone", "desktop", "lowres"]) {
    expect(report.ocr[0].samples[id].total).toHaveLength(3);
    expect(report.ocr[0].samples[id].cer).toBeLessThan(0.2);
  }
  expect(JSON.stringify(report)).not.toContain("祕密");
  await expect(page.getByRole("button", { name: "複製結果" })).toBeEnabled();
});

test("裝置量測：讀不到 canvas 時文字辨識不能量，結果記下這一點", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof original>) {
      const real = original.apply(this, args);
      crypto.getRandomValues(real.data.subarray(0, Math.min(real.data.length, 65536)));
      return real;
    };
  });
  await page.goto("./bench/");
  await expect(page.getByTestId("bench-ocr-canvas")).toContainText("不讓網頁讀取畫面的像素");
  await expect(page.getByRole("button", { name: "量測文字辨識" })).toBeDisabled();
});

test("裝置量測：語言模型從鎖定的 commit 下載，下載失敗時畫面上說明是哪個檔案", async ({ page, guard }) => {
  const asked: string[] = [];
  await page.context().route("https://huggingface.co/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("./bench/");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  await page.getByLabel(/^Qwen3 0\.6B/).check();
  await page.getByLabel("CPU", { exact: true }).check();
  await page.getByRole("button", { name: "開始量測" }).click();
  await expect(page.getByTestId("bench-status")).toContainText("量測失敗", { timeout: 30_000 });
  const pinned = `https://huggingface.co/${models["qwen3-0.6b"].repo}/resolve/${models["qwen3-0.6b"].revision}/`;
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(pinned))).toBe(true);
  await expect(page.getByRole("button", { name: "開始量測" })).toBeEnabled();
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://huggingface.co/"));
  // 測試故意回 404，WebKit 會把它記成主控台錯誤
  guard.errors = guard.errors.filter((e) => !e.includes("status of 404"));
});

test("裝置量測：個資辨識從 assets.anoni.net 下載，內容對不上 SHA-256 時說明，結果記下失敗的設定", async ({ page, guard }) => {
  const asked: string[] = [];
  const dir = assetsUrl(PII_MODEL.dir, "");
  // 回一份內容不對的檔案，確認會停下來
  await page.context().route("https://assets.anoni.net/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await page.goto("./bench/");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  const section = page.locator('section[aria-labelledby="bench-pii-title"]');
  await section.getByRole("button", { name: /^量測個資辨識/ }).click();
  await expect(page.getByTestId("bench-pii-status")).toContainText("量測失敗", { timeout: 30_000 });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(dir))).toBe(true);
  await expect(page.getByTestId("bench-pii-table")).toContainText("量測失敗");
  // 結果的 JSON 帶著這一筆，格式是第 2 版
  await page.getByText("看複製的內容", { exact: true }).click();
  const report = JSON.parse((await page.getByTestId("bench-report").textContent())!);
  expect(report.schema).toBe(2);
  expect(report.pii[0].error).toBeTruthy();
  expect(report.pii[0].model).toContain(PII_MODEL.repo);
  guard.requests = guard.requests.filter((url) => !url.startsWith(dir));
  guard.errors = guard.errors.filter((e) => !e.includes("status of 404"));
});

test("裝置量測：個資辨識量到一半頁面重新載入時，結果記成 crashed", async ({ page }) => {
  await page.goto("./bench/");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  // 模擬量測中被系統重新載入：history.state 留著量測中的記號
  await page.evaluate(() => history.replaceState({ ...(history.state ?? {}), gearsPiiBench: { threads: 1, webgpu: false } }, ""));
  await page.reload();
  await expect(page.getByTestId("bench-pii-status")).toContainText("頁面重新載入了");
  await expect(page.getByTestId("bench-pii-table")).toContainText("可能是記憶體不夠");
  await page.getByText("看複製的內容", { exact: true }).click();
  const report = JSON.parse((await page.getByTestId("bench-report").textContent())!);
  expect(report.pii).toEqual([expect.objectContaining({ threads: 1, webgpu: false, crashed: true })]);
});

import type { Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assetsUrl } from "../../src/core/models.ts";
import { DINO_MODEL } from "../../src/tools/verify/dino-model.ts";
import { type Kind, similarImage } from "../helpers/similar.ts";
import { type Guard, downloadFrom, expect, test } from "./guard.ts";

// 查證的「相近的圖片」（src/ui/SimilarImages.tsx）。PDQ 用的圖在頁面裡用 canvas 畫（tests/helpers/similar.ts）。
// PDQ 不用模型，每種瀏覽器都執行。DINOv2 的模型從 assets.anoni.net 下載：一般的測試攔下來、回內容不對的檔案，
// 確認會停下來。真的模型只在本機的 Chromium、設了 GEARS_DINO_MODEL=1 時執行，模型檔、照片與特徵取自本機的評測目錄
// （~/tmp/similar-exp/，GEARS_DINO_EXP 可以換），模型用 route 提供，約 24 MB。關掉 WebAssembly 與讀不到 canvas 的情況在
// wasm-unavailable.spec.ts、canvas-blocked.spec.ts

const DIR = assetsUrl(DINO_MODEL.dir, "");

const image = similarImage;

const files = async (page: Page, kinds: [string, Kind][]) => Promise.all(kinds.map(async ([name, kind]) => ({ name, mimeType: kind === "flip" ? "image/png" : "image/jpeg", buffer: await image(page, kind) })));

async function openVerify(page: Page, kinds: [string, Kind][]) {
  await page.goto("./verify/");
  await page.getByTestId("verify-input").setInputFiles(await files(page, kinds));
}

// 按下模型的按鈕。手機與平板（iPhone 那個 project）先展開說明，按「仍要使用」才開始
async function startModel(page: Page) {
  await page.getByRole("button", { name: "也比對裁切、加字之後的版本" }).click();
  const ask = page.getByTestId("similar-model-ask");
  if (await ask.isVisible()) await ask.getByRole("button", { name: "仍要使用" }).click();
}

const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

test("同一張圖的縮小版與翻轉版分在同一組，不同的圖不分進來，每張列出解析度與檔案大小，不顯示分數", async ({ page }) => {
  await openVerify(page, [
    ["photo.jpg", "orig"],
    ["photo-small.jpg", "small"],
    ["photo-flip.png", "flip"],
    ["other.jpg", "other"],
  ]);
  const section = page.getByTestId("verify-similar");
  await expect(section.getByRole("heading", { name: "相近的圖片" })).toBeVisible({ timeout: 20_000 });
  const groups = section.getByTestId("similar-group");
  await expect(groups).toHaveCount(1, { timeout: 20_000 });
  const group = groups.first();
  await expect(group).toHaveAttribute("data-layer", "pdq");
  await expect(group.getByRole("heading", { name: "第 1 組，3 張" })).toBeVisible();
  await expect(group.getByText("內容相近，可能是同一張圖縮小、重新壓縮、調色或翻轉之後的版本。")).toBeVisible();
  for (const name of ["photo.jpg", "photo-small.jpg", "photo-flip.png"]) await expect(group.getByText(name, { exact: true })).toBeVisible();
  await expect(group.getByText("other.jpg", { exact: true })).toHaveCount(0);
  // 讀者判斷用的線索：解析度、檔案大小、中繼資料、拍攝時間
  await expect(group.getByText("1200 × 800")).toHaveCount(2);
  await expect(group.getByText("600 × 400")).toBeVisible();
  await expect(group.getByRole("img", { name: "photo-small.jpg 的縮圖" })).toBeVisible();
  // 沒有百分比與分數
  await expect(section).not.toContainText("%");
  // 只用 PDQ 時寫明裁切、加字要用模型比對，以及找不回的情況
  await expect(section).toContainText("裁切、加字與加框之後的版本要另外用模型比對");
  await expect(section).toContainText("沒有分在同一組，不代表不是同一張照片");
});

test("內容完全相同的複本只比一次，在那一張下面註明，匯出的紀錄寫出分組", async ({ page }) => {
  await page.goto("./verify/");
  const orig = await image(page, "orig");
  await page.getByTestId("verify-input").setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: orig },
    { name: "a-copy.jpg", mimeType: "image/jpeg", buffer: orig },
    { name: "a-small.jpg", mimeType: "image/jpeg", buffer: await image(page, "small") },
  ]);
  const group = page.getByTestId("similar-group");
  await expect(group).toHaveCount(1, { timeout: 20_000 });
  await expect(group.getByRole("heading", { name: "第 1 組，2 張" })).toBeVisible();
  await expect(group.getByText("跟 a-copy.jpg 內容完全相同")).toBeVisible();
  // 內容完全相同仍然列在需要留意的地方
  await expect(page.locator(".verify-warnings").getByText("內容完全相同")).toBeVisible();
  const { data } = await downloadFrom(page, () => page.getByRole("button", { name: "下載查證紀錄" }).click());
  const text = new TextDecoder().decode(data);
  expect(text).toContain("## 相近的圖片");
  expect(text).toContain("比對方式：PDQ 感知雜湊（不用模型）。");
  expect(text).toContain("- 第 1 組，2 張：a.jpg、a-small.jpg。內容相近，可能是同一張圖縮小、重新壓縮、調色或翻轉之後的版本。");
});

test("圖片不到兩張時不顯示相近的圖片", async ({ page }) => {
  await openVerify(page, [["photo.jpg", "orig"]]);
  await expect(page.locator(".verify-card")).toHaveCount(1);
  await expect(page.getByTestId("verify-hash")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("verify-similar")).toHaveCount(0);
});

test("模型比對：還沒下載時寫出下載量，模型的內容對不上時停下來說明，不分錯組", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await openVerify(page, [
    ["photo.jpg", "orig"],
    ["photo-crop.jpg", "crop"],
  ]);
  await expect(page.getByTestId("similar-none")).toBeVisible({ timeout: 20_000 });
  const note = page.getByTestId("similar-model-note");
  // 手機上的下載量寫在按下之後的說明裡
  if (testInfo.project.name === "iphone") await expect(note).not.toContainText("MB");
  else await expect(note).toContainText(/第一次使用要下載約 \d+ MB/);
  await startModel(page);
  await expect(page.getByTestId("similar-model-status")).toHaveText(/下載比對模型失敗/, { timeout: 90_000 });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(DIR))).toBe(true);
  await expect(page.getByTestId("similar-none")).toBeVisible();
  // 失敗之後記號清掉，不會被當成記憶體不夠
  expect(await page.evaluate(() => sessionStorage.getItem("gears-dino"))).toBeNull();
  forgetRouted(guard);
});

test("模型比對：上一次做到一半頁面重新載入了，說明原因，這個分頁不再提供按鈕", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(() => sessionStorage.setItem("gears-dino", "1"));
  await openVerify(page, [
    ["photo.jpg", "orig"],
    ["photo-small.jpg", "small"],
  ]);
  await expect(page.getByTestId("similar-group")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("similar-crashed")).toContainText("記憶體不夠");
  await expect(page.getByRole("button", { name: "也比對裁切、加字之後的版本" })).toHaveCount(0);
  // 再加入一張圖，記號照樣留著，按鈕不會回來
  await page.getByTestId("verify-input").setInputFiles({ name: "photo-flip.png", mimeType: "image/png", buffer: await image(page, "flip") });
  await expect(page.getByTestId("similar-group").getByText("photo-flip.png", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("similar-crashed")).toBeVisible();
  await expect(page.getByRole("button", { name: "也比對裁切、加字之後的版本" })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("gears-dino"))).toBe("1");
});

test("模型比對：手機上先說明還在測試，可以先去協助測試頁量測，電腦上直接開始", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  await page.context().route(`${DIR}**`, (route) => route.fulfill({ status: 200, body: "not the model" }));
  await openVerify(page, [
    ["photo.jpg", "orig"],
    ["photo-crop.jpg", "crop"],
  ]);
  await expect(page.getByTestId("similar-none")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "也比對裁切、加字之後的版本" }).click();
  const ask = page.getByTestId("similar-model-ask");
  if (testInfo.project.name !== "iphone") {
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId("similar-model-status")).toHaveText(/下載比對模型失敗/, { timeout: 90_000 });
    forgetRouted(guard);
    return;
  }
  await expect(ask).toContainText("在手機與平板上還在測試");
  await expect(ask).toContainText(/約 \d+ MB/);
  await expect(ask).toContainText("約 750 MB");
  // 還沒開始：沒有記號，也沒有下載
  expect(await page.evaluate(() => sessionStorage.getItem("gears-dino"))).toBeNull();
  await ask.getByRole("link", { name: "先幫忙量測" }).click();
  await expect(page).toHaveURL(/\/testing\/$/);
  await expect(page.getByTestId("testing-similar")).toBeVisible();
  forgetRouted(guard);
});

// 真的模型：本機有社群工作區評測（research/gears-similar/）用的模型、照片與特徵時執行。模型檔用 route 提供，
// 照片用評測的 CC0 照片（貓的原圖、四周各裁掉一成的版本、富士山），算出的特徵跟評測在 Chromium 存下的 CLS 特徵比對，
// 確認前處理、模型檔與取特徵的方式跟訂門檻時相同
const EXP = process.env.GEARS_DINO_EXP ?? join(homedir(), "tmp/similar-exp");
const MODEL_DIR = join(EXP, "models/onnx-community/dinov2-small-ONNX");
const PHOTOS = ["cat__orig.jpg", "cat__center10.jpg", "fuji__orig.jpg"];
const REFERENCE = join(EXP, "results/chromium-dino-onnx-community_dinov2-small-ONNX_int8_full.json");

test("模型比對：裁掉一成的版本分進同一組、改寫 DINOv2 的說明，特徵跟評測相同，已下載的模型多一列", async ({ page, guard, browserName }) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_DINO_MODEL !== "1", "真的模型（約 24 MB）要設 GEARS_DINO_MODEL=1");
  test.skip(!existsSync(join(MODEL_DIR, "onnx/model_int8.onnx")) || !existsSync(REFERENCE), `找不到 ${EXP} 的模型或評測結果`);
  test.setTimeout(180_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    const file = route.request().url().slice(DIR.length);
    asked.push(file);
    return route.fulfill({ status: 200, body: readFileSync(join(MODEL_DIR, file)), headers: { "access-control-allow-origin": "*", "content-type": "application/octet-stream" } });
  });
  // 記下 Worker 回覆的特徵，跟評測比對
  await page.addInitScript(() => {
    const Original = window.Worker;
    (window as unknown as { dinoFeatures: Float32Array[] }).dinoFeatures = [];
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (e: MessageEvent) => {
          if (e.data?.type === "result" && Array.isArray(e.data.features)) (window as unknown as { dinoFeatures: Float32Array[] }).dinoFeatures.push(...e.data.features.map((f: Float32Array) => Array.from(f)));
        });
      }
    };
  });
  await page.goto("./verify/");
  await page.getByTestId("verify-input").setInputFiles(PHOTOS.map((name) => join(EXP, "data/img", name)));
  await expect(page.getByTestId("similar-none")).toBeVisible({ timeout: 20_000 });
  const started = Date.now();
  await startModel(page);
  await expect(page.getByTestId("similar-model-status")).toHaveText("已經用模型比對 3 張圖片。", { timeout: 150_000 });
  console.log(`下載加比對 ${((Date.now() - started) / 1000).toFixed(1)} 秒，請求的檔案：${asked.join("、")}`);
  // Transformers.js 只讀設定與 int8 的模型檔
  expect([...asked].sort()).toEqual(["config.json", "onnx/model_int8.onnx"]);
  const group = page.getByTestId("similar-group");
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute("data-layer", "dino");
  await expect(group.getByText("也可能是同一個場景、同一地點同一角度拍的另一張照片")).toBeVisible();
  await expect(group.getByText("cat__center10.jpg", { exact: true })).toBeVisible();
  await expect(group.getByText("fuji__orig.jpg", { exact: true })).toHaveCount(0);
  // 用過模型之後，限制只寫找不回的情況
  await expect(page.getByTestId("verify-similar")).not.toContainText("要另外用模型比對");
  expect(await page.evaluate(() => sessionStorage.getItem("gears-dino"))).toBeNull();
  // 跟評測存下的 CLS 特徵（同樣整張壓成 224 × 224、int8）比對
  const got = await page.evaluate(() => (window as unknown as { dinoFeatures: number[][] }).dinoFeatures);
  const ref = JSON.parse(readFileSync(REFERENCE, "utf8")).tasks["dino:onnx-community/dinov2-small-ONNX:int8:full"].emb as { file: string; cls: number[] }[];
  const gaps = PHOTOS.map((name, i) => {
    const r = ref.find((x) => x.file === name)!.cls;
    return 1 - r.reduce((s, v, k) => s + v * got[i]![k]!, 0);
  });
  console.log(`跟評測的特徵差距（1 − cos）：${gaps.map((g) => g.toFixed(4)).join("、")}`);
  for (const g of gaps) expect(g).toBeLessThan(0.01);
  await page.goto("./storage/");
  await expect(page.getByText("比對相近圖片的模型")).toBeVisible();
  forgetRouted(guard);
});

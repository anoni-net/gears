import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import models from "../../src/tools/transcribe/models.json" with { type: "json" };
import speakerModel from "../../src/tools/transcribe/speaker-model.json" with { type: "json" };
import vadModel from "../../src/tools/transcribe/vad-model.json" with { type: "json" };
import { wav } from "../helpers/audio.ts";
import { syntheticMp4 } from "../helpers/media.ts";
import { expect, test } from "./guard.ts";

// 模型很大，不進 repo，要先執行 node scripts/fetch-whisper.mjs base（CI 會先下載 base）
const BASE_MODEL = join(import.meta.dirname, "../../public/models/whisper", models.base.dir, "onnx/decoder_model_merged_quantized.onnx");
const hasModel = existsSync(BASE_MODEL);
const hasSherpa = existsSync(join(import.meta.dirname, "../../public/vendor/sherpa/sherpa-onnx-wasm-web.wasm"));
const hasSpeakerModel = existsSync(join(import.meta.dirname, "../../public/models/speaker", speakerModel.dir, speakerModel.file));
// 語音偵測的 Silero VAD（node scripts/fetch-whisper.mjs vad），沒有時 Worker 退回音量判斷
const hasVad = existsSync(join(import.meta.dirname, "../../public/models/vad", vadModel.dir, vadModel.file));
// Whisper base 在 CPU 上的兩個模型檔，加上語音偵測的模型
const BASE_ONNX = ["decoder_model_merged_quantized.onnx", "encoder_model_quantized.onnx", ...(hasVad ? [vadModel.file] : [])];

// 白噪音（固定的亂數種子），音量判斷會把整段當成有人說話
function noise(seconds: number) {
  let seed = 7;
  return wav(seconds, 16000, () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return (seed / 2 ** 31 - 0.5) * 0.3;
  });
}

async function open(page: Page, name: string, data: Uint8Array) {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(data) });
  await expect(page.getByRole("button", { name: "開始轉逐字稿" })).toBeVisible();
}

test("選了錄音之後列出模型與下載大小，可以選核心數", async ({ page, browserName }) => {
  await open(page, "talk.wav", wav(2));
  await expect(page.getByLabel(/^small：準確度較好/)).toBeChecked();
  await expect(page.getByText(`下載約 ${Math.round(models.small.bytes / 1e6)} MB`)).toBeVisible();
  await expect(page.getByText(`下載約 ${Math.round(models.base.bytes / 1e6)} MB`)).toBeVisible();
  await expect(page.getByText(/第一次使用要下載模型/)).toBeVisible();
  // 一定要選語言：Transformers.js 沒有語言偵測，不指定時會翻成英文
  await expect(page.getByLabel("華語", { exact: true })).toBeChecked();
  await expect(page.getByLabel("日語", { exact: true })).toBeVisible();
  await expect(page.getByText("自動判斷")).toHaveCount(0);
  // 預覽伺服器送了 COOP 與 COEP，可以用多個核心
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  // 預設值依瀏覽器回報的核心數決定（src/tools/transcribe/threads.ts），測試的機器上至少勾了一個
  await expect(page.locator('input[name="transcribe-threads"]:checked')).toHaveCount(1);
  // Firefox 用多個核心偶爾會停住，預設 1 個並說明（src/tools/transcribe/threads.ts）
  if (browserName === "firefox") {
    await expect(page.getByLabel("1", { exact: true })).toBeChecked();
    await expect(page.getByText(/^Firefox 用多個核心時/)).toBeVisible();
  } else await expect(page.getByText(/^Firefox 用多個核心時/)).toHaveCount(0);
  await page.getByLabel("2", { exact: true }).check();
  await expect(page.getByLabel("2", { exact: true })).toBeChecked();
});

test("large-v3-turbo 從 Hugging Face 下載：先說明，SHA-256 對不上就不存", async ({ page, guard }) => {
  // 攔下送到 Hugging Face 的請求，回一份內容不對的檔案。也驗證了標頭的 CSP 放行下載的路徑
  const served: string[] = [];
  await page.context().route("https://huggingface.co/**", (route) => {
    served.push(route.request().url());
    return route.fulfill({ status: 200, body: "{}", headers: { "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" } });
  });
  await open(page, "talk.wav", wav(2));
  await page.getByLabel(/^large-v3-turbo：最準確/).check();
  await expect(page.getByText(`從 Hugging Face 下載約 ${Math.round(models.turbo.bytes / 1e6)} MB`)).toBeVisible();
  await expect(page.getByTestId("transcribe-remote")).toContainText("這個模型從 Hugging Face 下載");
  // Hugging Face 可得知什麼寫在隱私說明，畫面上只連過去、開新分頁
  const privacyLink = page.getByTestId("transcribe-remote").getByTestId("privacy-link");
  await expect(privacyLink).toHaveAttribute("href", "/gears/privacy/#privacy-models");
  await expect(privacyLink).toHaveAttribute("target", "_blank");
  // 選了模型還不會連線，按下按鈕才下載
  expect(served).toEqual([]);
  await page.getByRole("button", { name: "從 Hugging Face 下載並開始" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^下載模型失敗/, { timeout: 60_000 });
  expect(served[0]).toBe(`https://huggingface.co/${models.turbo.repo}/resolve/${models.turbo.revision}/config.json`);
  const stored = await page.evaluate(async (dir) => {
    const cache = await caches.open("gears-models");
    return (await cache.keys()).filter((r) => r.url.includes(dir)).length;
  }, models.turbo.dir);
  expect(stored).toBe(0);
  // Worker 的請求有時也出現在頁面的請求清單，這些是刻意送出的，從守門程式的清單拿掉
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://huggingface.co/"));
});

test("先選語言，再列出能用的模型：泰語、台語預設用專門訓練的模型", async ({ page }) => {
  await open(page, "talk.wav", wav(2));
  // 語言在模型前面
  const language = await page.getByRole("group", { name: "語言" }).boundingBox();
  const model = await page.getByRole("group", { name: "模型" }).boundingBox();
  expect(language!.y).toBeLessThan(model!.y);
  await expect(page.getByLabel(/^Breeze-ASR-25/)).toBeVisible();
  await expect(page.getByLabel(/^泰語專用/)).toHaveCount(0);
  await page.getByLabel("泰語", { exact: true }).check();
  await expect(page.getByLabel(/^泰語專用/)).toBeChecked();
  await expect(page.getByLabel(/^Breeze-ASR-25/)).toHaveCount(0);
  await page.getByLabel("台語", { exact: true }).check();
  await expect(page.getByLabel(/^Breeze-ASR-26/)).toBeChecked();
  await expect(page.getByRole("group", { name: "模型" }).getByRole("radio")).toHaveCount(1);
  // 粵語只有 large-v3-turbo，說明輸出的是書面中文
  await page.getByLabel("粵語", { exact: true }).check();
  await expect(page.getByLabel(/^large-v3-turbo/)).toBeChecked();
  await expect(page.getByRole("group", { name: "模型" }).getByRole("radio")).toHaveCount(1);
  await expect(page.getByTestId("transcribe-yue")).toBeVisible();
  // 回到華語時用 small
  await page.getByLabel("華語", { exact: true }).check();
  await expect(page.getByLabel(/^small/)).toBeChecked();
});

test("社群轉檔的模型從 assets.anoni.net 下載，SHA-256 對不上就不存", async ({ page, guard }) => {
  // 攔下送到 assets.anoni.net 的請求，回一份內容不對的檔案。也驗證了標頭的 CSP 放行模型的目錄
  const served: string[] = [];
  await page.context().route("https://assets.anoni.net/**", (route) => {
    served.push(route.request().url());
    return route.fulfill({ status: 200, body: "{}", headers: { "access-control-allow-origin": "*" } });
  });
  await open(page, "talk.wav", wav(2));
  await page.getByLabel("泰語", { exact: true }).check();
  // 社群自己的網域，不像 Hugging Face 那樣另外說明
  await expect(page.getByTestId("transcribe-remote")).toHaveCount(0);
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^下載模型失敗/, { timeout: 60_000 });
  expect(served[0]).toBe(`https://assets.anoni.net/gears/models/${models.thai.dir}/config.json`);
  const stored = await page.evaluate(async (dir) => {
    const cache = await caches.open("gears-models");
    return (await cache.keys()).filter((r) => r.url.includes(dir)).length;
  }, models.thai.dir);
  expect(stored).toBe(0);
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://assets.anoni.net/"));
});

test("緬甸語用 sherpa-onnx 的 Omnilingual：只能用 1 個核心，模型從 assets.anoni.net 下載", async ({ page, guard }) => {
  test.skip(!hasSherpa, "沒有下載 sherpa-onnx 的 WebAssembly");
  test.setTimeout(120_000);
  const served: string[] = [];
  await page.context().route("https://assets.anoni.net/**", (route) => {
    served.push(route.request().url());
    return route.fulfill({ status: 200, body: "{}", headers: { "access-control-allow-origin": "*" } });
  });
  await open(page, "talk.wav", wav(2));
  await page.getByLabel("緬甸語", { exact: true }).check();
  await expect(page.getByLabel(/^Omnilingual/)).toBeChecked();
  await expect(page.getByRole("group", { name: "模型" }).getByRole("radio")).toHaveCount(1);
  // 沒有核心數、顯示卡與分辨說話者的選項，改成說明
  await expect(page.getByTestId("transcribe-sherpa")).toBeVisible();
  await expect(page.getByRole("group", { name: "同時使用的 CPU 核心" })).toHaveCount(0);
  await expect(page.getByLabel(/^分辨說話者/)).toHaveCount(0);
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  // sherpa-onnx 的 WebAssembly 從自己的網域載入，模型的內容不對就停下來
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^下載模型失敗/, { timeout: 90_000 });
  expect(served[0]).toBe(`https://assets.anoni.net/gears/models/${models.omni.dir}/tokens.txt`);
  guard.requests = guard.requests.filter((url) => !url.startsWith("https://assets.anoni.net/"));
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
  // 離線快取的測試涵蓋）
  test.setTimeout(240_000);
  const onnx: string[] = [];
  page.on("request", (r) => r.url().endsWith(".onnx") && onnx.push(new URL(r.url()).pathname.split("/").pop()!));
  await open(page, "silence.wav", wav(5));
  await page.getByLabel(/^base：比較快/).check();
  await page.getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
  // 每個模型檔只請求一次。Transformers.js 有 progress_callback 時會先發一次不讀內容的 GET 查大小，
  // 這些連線佔住瀏覽器的連線數，Firefox 會慢到兩分鐘、偶發整個停住（src/ui/transcribe.worker.ts）
  expect(onnx.sort()).toEqual(BASE_ONNX);
});

test("背景噪音：Silero VAD 判斷沒有人說話，一段都不送進 Whisper", async ({ page }) => {
  test.skip(!hasModel || !hasVad, "沒有下載 base 或 Silero VAD 模型");
  test.setTimeout(240_000);
  await open(page, "noise.wav", noise(12));
  await expect(page.getByTestId("transcribe-vad-note")).toHaveText("只轉換有人說話的部分，歌聲與背景音樂不會轉成文字。");
  await page.getByLabel(/^base：比較快/).check();
  await page.getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
  await expect(page.getByTestId("transcribe-status")).toHaveAttribute("data-pieces", "0");
  await expect(page.getByTestId("transcribe-vad")).toHaveCount(0);
  await expect(page.getByTestId("transcript")).toHaveCount(0);
});

test("Silero VAD 載入失敗時退回音量判斷，畫面說明，噪音照樣送進 Whisper", async ({ page, guard }) => {
  test.skip(!hasModel, "沒有下載 base 模型");
  test.setTimeout(240_000);
  await page.context().route("**/models/vad/**", (route) => route.fulfill({ status: 404, body: "" }));
  await open(page, "noise.wav", noise(12));
  await page.getByLabel(/^base：比較快/).check();
  await page.getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-vad")).toHaveText(/^語音偵測的模型無法載入，這次改用音量判斷/, { timeout: 200_000 });
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^(沒有辨識到說話的內容。|完成，共 \d+ 段)/, { timeout: 200_000 });
  // 音量判斷把整段噪音當成說話，送進 Whisper
  expect(Number(await page.getByTestId("transcribe-status").getAttribute("data-pieces"))).toBeGreaterThan(0);
  // 故意讓模型回 404，WebKit 會在主控台留下載入失敗的紀錄（同 bench.spec.ts）
  guard.errors = guard.errors.filter((e) => !e.includes("status of 404"));
});

test("緬甸語這類 sherpa-onnx 的模型不寫歌聲與背景音樂的說明（仍用音量判斷）", async ({ page }) => {
  await open(page, "talk.wav", wav(2));
  await expect(page.getByTestId("transcribe-vad-note")).toBeVisible();
  await page.getByLabel("緬甸語", { exact: true }).check();
  await expect(page.getByTestId("transcribe-vad-note")).toHaveCount(0);
});

test("顯示卡無法使用時改用 CPU，畫面上說明", async ({ page }) => {
  test.skip(!hasModel, "沒有下載 base 模型");
  test.setTimeout(240_000);
  const onnx: string[] = [];
  page.on("request", (r) => r.url().endsWith(".onnx") && onnx.push(new URL(r.url()).pathname.split("/").pop()!));
  // ?gpu=force 讓畫面當成顯示卡可以用，測試的瀏覽器拿不到 adapter，Worker 會失敗（src/ui/gpu.ts）
  await page.goto("./transcribe/?gpu=force");
  await page.getByTestId("file-input").setInputFiles({ name: "silence.wav", mimeType: "application/octet-stream", buffer: Buffer.from(wav(5)) });
  await page.getByLabel(/^base：比較快/).check();
  await expect(page.getByLabel(/^用顯示卡加速/)).toBeChecked();
  // 用顯示卡時下載的是 4 位元版
  await expect(page.getByText(`下載約 ${Math.round(models.base.webgpu.bytes / 1e6)} MB`)).toBeVisible();
  await page.getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
  await expect(page.getByTestId("transcribe-device")).toHaveText("顯示卡無法使用，這次改用 CPU，另外下載 CPU 用的模型。");
  // Worker 先確認拿不到 adapter，沒有下載 4 位元的模型
  expect(onnx.sort()).toEqual(BASE_ONNX);
});

test("換核心數再轉一次，換新的 Worker", async ({ page, browserName }) => {
  test.skip(!hasModel, "沒有下載 base 模型");
  // Firefox 在整組測試同時執行、記憶體很緊時，第二個多執行緒的 Worker 偶爾建不起推論環境（單獨執行、
  // 只加 CPU 負載都重現不了），畫面會在 3 分鐘後停下來說明（STALL_MS）。這個測試為 WebKit 而寫
  test.skip(browserName === "firefox", "記憶體很緊時偶發停住，見上方說明");
  test.setTimeout(240_000);
  // WebKit 第二次用同一個網址建立 Worker 會被 COEP 擋下，網址每次加上不同的查詢字串
  await open(page, "silence.wav", wav(5));
  await page.getByLabel(/^base：比較快/).check();
  await page.getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "再轉一次" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
});

test("建置產物裡沒有其他檔案匯入 Worker 的進入點", ({ browserName }) => {
  // WebKit 會把被匯入的 Worker 進入點當成另一份模組再執行一次，蓋掉 onmessage（src/ui/speaker-embed.ts）。
  // 只看建置產物，一種瀏覽器檢查一次就夠
  test.skip(browserName !== "chromium");
  // Worker 的進入點認內容（有 onmessage），不認檔名：逐字稿與裝置量測共用 Worker 的網址時，放網址的小 chunk
  // 也會以 transcribe.worker 命名，那一份不是進入點，匯入它沒有問題
  const assets = join(import.meta.dirname, "../../dist/assets");
  const js = readdirSync(assets).filter((f) => f.endsWith(".js"));
  const read = (f: string) => readFileSync(join(assets, f), "utf8");
  const entries = js.filter((f) => f.startsWith("transcribe.worker-") && /onmessage/.test(read(f)));
  expect(entries).toHaveLength(1);
  const entry = entries[0]!.replace(/[.-]/g, "\\$&");
  const offenders = js.filter((f) => f !== entries[0] && new RegExp(`(from|import)\\s*\\(?\\s*["'\`][^"'\`]*/${entry}["'\`]`).test(read(f)));
  expect(offenders).toEqual([]);
});

test("分辨說話者：從自己的網域載入聲紋模型，跟 Whisper 共用 onnxruntime", async ({ page }) => {
  test.skip(!hasModel || !hasSpeakerModel, "沒有下載 base 或 CAM++ 模型");
  test.setTimeout(240_000);
  const loaded: string[] = [];
  page.on("request", (r) => r.url().includes("/models/speaker/") && loaded.push(new URL(r.url()).pathname));
  await open(page, "silence.wav", wav(5));
  await page.getByLabel(/^base：比較快/).check();
  await page.getByLabel("1", { exact: true }).check();
  await expect(page.getByText(`另外下載約 ${Math.round(speakerModel.bytes / 1e6)} MB`)).toBeVisible();
  await page.getByLabel(/^分辨說話者/).check();
  await page.getByRole("button", { name: "開始轉逐字稿" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 200_000 });
  expect(loaded).toEqual([`/gears/models/speaker/${speakerModel.dir}/${speakerModel.file}`]);
});

test("超過 256 MB、2.5 小時的 WAV 分段處理，記憶體裡只有一段", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "大檔案只在 Chromium 測");
  test.skip(!hasModel, "沒有下載 base 模型");
  test.setTimeout(300_000);
  // 16 kHz、16 位元單聲道的靜音，2.5 小時約 288 MB。寫成檔案再交給瀏覽器，不經過記憶體
  const path = join(tmpdir(), `gears-long-${process.pid}.wav`);
  const seconds = 2.5 * 3600;
  const header = wav(0);
  const view = new DataView(header.buffer);
  view.setUint32(4, 36 + seconds * 32000, true);
  view.setUint32(40, seconds * 32000, true);
  writeFileSync(path, header);
  const silence = Buffer.alloc(32000 * 600);
  for (let i = 0; i < seconds / 600; i++) appendFileSync(path, silence);
  try {
    await page.goto("./transcribe/");
    await page.getByTestId("file-input").setInputFiles(path);
    await page.getByLabel(/^base：比較快/).check();
    await page.getByLabel("1", { exact: true }).check();
    await page.getByRole("button", { name: "開始轉逐字稿" }).click();
    await expect(page.getByTestId("transcribe-status")).toContainText("共 2:30:00", { timeout: 120_000 });
    await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 240_000 });
  } finally {
    rmSync(path, { force: true });
  }
});

test.describe("離線快取", () => {
  test.use({ serviceWorkers: "allow" });

  test("模型存進不隨版本清掉的快取，可以刪除", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "service worker 的測試只在 Chromium 執行");
    test.skip(!hasModel, "沒有下載 base 模型");
    // 經過 service worker 下載模型，跟其他測試平行執行時比較慢
    test.setTimeout(300_000);
    await page.goto("./transcribe/");
    await expect(page.getByTestId("offline-ready")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.getByTestId("file-input").setInputFiles({ name: "silence.wav", mimeType: "audio/wav", buffer: Buffer.from(wav(5)) });
    await page.getByLabel(/^base：比較快/).check();
    await page.getByRole("button", { name: "開始轉逐字稿" }).click();
    await expect(page.getByTestId("transcribe-status")).toHaveText("沒有辨識到說話的內容。", { timeout: 240_000 });
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

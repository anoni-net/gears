import AxeBuilder from "@axe-core/playwright";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { assetsUrl } from "../../src/core/models.ts";
import { PUNCT_MB, PUNCT_MODEL } from "../../src/tools/transcribe/punct.ts";
import { wav } from "../helpers/audio.ts";
import { type Guard, downloadFrom, expect, test } from "./guard.ts";

// 逐字稿的標點建議（src/ui/punct-detect.ts）。CI 上沒有會產生段落的錄音與模型，辨識的 Worker 換成固定回覆
// 幾段華語的假 Worker，標點的 Worker 也換成固定回覆的假 Worker，測按鈕出現的條件、手機上的確認、當機記號，
// 以及接受與捨棄之後匯出的內容。模型下載失敗那一項用真的標點 Worker，攔下模型的請求回內容不對的檔案。
// 真的下載與執行模型（約 148 MB）只在本機的 Chromium、設了 GEARS_PUNCT_MODEL=1 時執行，請求直接經過 Cloudflare
// 的快取到 assets.anoni.net（同 redact-model.spec.ts 的 GEARS_PII_MODEL）

const DIR = assetsUrl(PUNCT_MODEL.dir, "");

interface Fake {
  segments: { start: number; end: number; text: string }[];
  // 標點的假 Worker：在收到的文字裡找到這段字，在它後面接這個標點。"hang" 是一直不回應（停在下載中）
  punct?: [after: string, mark: "." | "," | "?"][] | "hang";
}

const SEGMENTS = [
  { start: 0, end: 3, text: "今天天氣很好我們去公園" },
  { start: 3, end: 5, text: "你要一起來嗎？" },
  { start: 5, end: 6, text: "好啊" },
];
// 「來嗎」後面原本就有問號，模型的建議不會重複插入
const MARKS: [string, "." | "," | "?"][] = [
  ["很好", ","],
  ["公園", "."],
  ["來嗎", "?"],
  ["好啊", "."],
];

// 換掉頁面的 Worker：網址含 transcribe.worker 或 sherpa.worker 的回固定的段落，含 punct.worker 的（有設定時）回固定的標點，
// 其他照常建立
async function fakeWorkers(page: Page, fake: Fake) {
  await page.addInitScript((fake: Fake) => {
    const Real = globalThis.Worker;
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      sent = false;
      constructor(readonly kind: string) {}
      postMessage(data: { type?: string; text?: string }) {
        setTimeout(() => this.reply(data), 20);
      }
      send(data: unknown) {
        this.onmessage?.({ data });
      }
      reply(data: { type?: string; text?: string }) {
        if (this.kind === "transcribe") {
          // 同一個 Worker 會留著給下一次轉錄用，每次 start 重新送段落
          if (data.type === "start") {
            this.sent = false;
            return this.send({ type: "ready" });
          }
          if (!this.sent) {
            this.sent = true;
            this.send({ type: "segments", segments: fake.segments, pieces: fake.segments.length });
          }
          return this.send({ type: "done" });
        }
        if (fake.punct === "hang") return this.send({ type: "download", loaded: 1_000_000, total: 176_000_000 });
        this.send({ type: "loaded" });
        this.send({ type: "progress", done: 1, total: 1 });
        const text = data.text ?? "";
        const predictions = (fake.punct ?? []).filter(([after]) => text.includes(after)).map(([after, mark]) => [text.indexOf(after) + after.length, mark]);
        this.send({ type: "result", predictions });
      }
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    }
    globalThis.Worker = function (url: string | URL, options?: WorkerOptions) {
      const u = String(url);
      if (u.includes("transcribe.worker") || u.includes("sherpa.worker")) return new FakeWorker("transcribe");
      if (u.includes("punct.worker") && fake.punct) return new FakeWorker("punct");
      return new Real(url, options);
    } as unknown as typeof Worker;
  }, fake);
}

async function transcribe(page: Page, language = "華語") {
  await page.goto("./transcribe/");
  await page.getByTestId("file-input").setInputFiles({ name: "talk.wav", mimeType: "application/octet-stream", buffer: Buffer.from(wav(2)) });
  await page.getByLabel(language, { exact: true }).check();
  // 粵語只有 large-v3-turbo，按鈕寫成「從 Hugging Face 下載並開始」（假的 Worker 不會真的下載）
  await page.getByRole("button", { name: /^(開始轉逐字稿|從 Hugging Face 下載並開始)$/ }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^完成，共 \d+ 段/);
}

// 按下「建議標點」。手機與平板（iPhone 那個 project）先展開說明，按「仍要使用」才開始
async function suggest(page: Page) {
  await page.getByRole("button", { name: "建議標點" }).click();
  const ask = page.getByTestId("punct-ask");
  if (await ask.isVisible()) await ask.getByRole("button", { name: "仍要使用" }).click();
}

const txt = async (page: Page) => new TextDecoder().decode((await downloadFrom(page, () => page.getByRole("button", { name: "下載 TXT" }).click())).data);

const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

const phoneProject = (testInfo: TestInfo) => testInfo.project.name === "iphone";

test("標點建議：華語轉完之後出現按鈕，寫出下載量，轉完再換語言也照轉的時候判斷", async ({ page }, testInfo) => {
  await fakeWorkers(page, { segments: SEGMENTS });
  await transcribe(page);
  await expect(page.getByRole("button", { name: "建議標點" })).toBeVisible();
  // 手機上的下載量寫在按下之後的說明裡，上方的說明只給電腦
  if (phoneProject(testInfo)) await expect(page.getByTestId("punct-note")).not.toContainText("MB");
  else await expect(page.getByTestId("punct-note")).toContainText(`約 ${PUNCT_MB} MB`);
  await expect(page.getByTestId("punct-note")).toContainText("由你確認之後才套用");
  // 轉完之後改選英語，按鈕照轉的時候的語言出現
  await page.getByLabel("英語", { exact: true }).check();
  await expect(page.getByRole("button", { name: "建議標點" })).toBeVisible();
});

test("標點建議：英語、台語、粵語與 Omnilingual 的逐字稿不出現按鈕", async ({ page }) => {
  await fakeWorkers(page, { segments: [{ start: 0, end: 2, text: "hello world" }] });
  await transcribe(page, "英語");
  await expect(page.getByTestId("transcript")).toBeVisible();
  await expect(page.getByRole("button", { name: "建議標點" })).toHaveCount(0);
  // 同一個檔案換語言再轉一次（不重新載入頁面，暫存區有檔案時重新整理會先跳出確認）
  for (const language of ["台語", "粵語", "孟加拉語", "華語"]) {
    await page.getByLabel(language, { exact: true }).check();
    await page.getByRole("button", { name: /^(再轉一次|從 Hugging Face 下載並開始)$/ }).click();
    await expect(page.getByTestId("transcribe-status")).toHaveText(/^完成，共 \d+ 段/);
    await expect(page.getByTestId("transcript")).toBeVisible();
    await expect(page.getByRole("button", { name: "建議標點" })).toHaveCount(language === "華語" ? 1 : 0);
  }
});

test("標點建議：接受之前匯出原文，可以逐段接受、全部接受、復原與全部捨棄", async ({ page }) => {
  // 本機的 Firefox、WebKit 單獨執行就要 8 到 10 秒，CI 的機器只有 4 核心
  test.setTimeout(90_000);
  await fakeWorkers(page, { segments: SEGMENTS, punct: MARKS });
  await transcribe(page);
  const original = await txt(page);
  expect(original).toBe("[00:00] 今天天氣很好我們去公園\n[00:03] 你要一起來嗎？\n[00:05] 好啊\n");
  await suggest(page);
  // 原本就有問號的那一段沒有建議
  await expect(page.getByTestId("punct-status")).toHaveText(/^2 段有建議的標點/);
  const marks = page.getByTestId("transcript").locator("ins.punct-suggest");
  await expect(marks).toHaveText(["，", "。", "。"]);
  await expect(marks.first()).toHaveAttribute("title", "建議的標點");
  // 還沒接受：下載的是原文
  expect(await txt(page)).toBe(original);

  // 逐段接受第一段
  await page.getByRole("button", { name: "接受 00:00 這一段的建議標點" }).click();
  await expect(marks).toHaveText(["。"]);
  expect(await txt(page)).toBe("[00:00] 今天天氣很好，我們去公園。\n[00:03] 你要一起來嗎？\n[00:05] 好啊\n");
  // 復原之後建議回來
  await page.getByRole("button", { name: "復原" }).click();
  await expect(marks).toHaveText(["，", "。", "。"]);
  expect(await txt(page)).toBe(original);

  // 全部接受
  await page.getByRole("button", { name: "全部接受" }).click();
  await expect(marks).toHaveCount(0);
  await expect(page.getByTestId("punct-status")).toHaveText(/^建議的標點都處理完了/);
  const accepted = "[00:00] 今天天氣很好，我們去公園。\n[00:03] 你要一起來嗎？\n[00:05] 好啊。\n";
  expect(await txt(page)).toBe(accepted);

  // 復原回到有建議的狀態，再全部捨棄
  await page.getByRole("button", { name: "復原" }).click();
  await expect(marks).toHaveCount(3);
  await page.getByRole("button", { name: "全部捨棄" }).click();
  await expect(marks).toHaveCount(0);
  await expect(page.getByTestId("punct-status")).toHaveText(/^已捨棄建議的標點/);
  expect(await txt(page)).toBe(original);
  // 捨棄之後可以再按一次
  await expect(page.getByRole("button", { name: "建議標點" })).toBeVisible();

  // 重新轉一次時清掉建議
  await suggest(page);
  await expect(marks).toHaveCount(3);
  await page.getByRole("button", { name: "再轉一次" }).click();
  await expect(page.getByTestId("transcribe-status")).toHaveText(/^完成，共 \d+ 段/);
  await expect(marks).toHaveCount(0);
  await expect(page.getByTestId("punct-status")).toHaveCount(0);
});

test("標點建議：有建議時的畫面沒有無障礙問題，深色模式也是", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "無障礙檢查只在 Chromium 執行（同 a11y.spec.ts）");
  await fakeWorkers(page, { segments: SEGMENTS, punct: MARKS });
  await transcribe(page);
  await suggest(page);
  await expect(page.getByTestId("punct-status")).toHaveText(/^2 段有建議的標點/);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(" | ")})`), colorScheme).toEqual([]);
  }
});

test("標點建議：手機上先說明還在測試，可以先去協助測試頁量測，電腦上直接開始", async ({ page }, testInfo) => {
  await fakeWorkers(page, { segments: SEGMENTS, punct: MARKS });
  await transcribe(page);
  await page.getByRole("button", { name: "建議標點" }).click();
  const ask = page.getByTestId("punct-ask");
  if (!phoneProject(testInfo)) {
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId("punct-status")).toHaveText(/^2 段有建議的標點/);
    return;
  }
  await expect(ask).toContainText("在手機與平板上還在測試");
  await expect(ask).toContainText(`約 ${PUNCT_MB} MB`);
  await expect(ask).toContainText("約 1.4 GB");
  // 還沒開始：沒有記號
  expect(await page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBeNull();
  await ask.getByRole("link", { name: "先幫忙量測" }).click();
  await expect(page).toHaveURL(/\/testing\/$/);
  await expect(page.getByTestId("testing-phone")).toBeVisible();
});

test("標點建議：上一次做到一半頁面重新載入了，說明原因，這個分頁不再提供按鈕", async ({ page }) => {
  await fakeWorkers(page, { segments: SEGMENTS, punct: MARKS });
  await page.goto("./");
  await page.evaluate(() => sessionStorage.setItem("gears-punct", "1"));
  await transcribe(page);
  await expect(page.getByTestId("punct-crashed")).toContainText("記憶體不夠");
  await expect(page.getByTestId("transcript")).toBeVisible();
  await expect(page.getByRole("button", { name: "建議標點" })).toHaveCount(0);
  // 開始轉逐字稿與關掉畫面時沒有在執行標點，記號留著，同一個分頁之後打開逐字稿也不提供按鈕
  expect(await page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBe("1");
  await page.getByRole("button", { name: "取消" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBe("1");
});

test("標點建議：下載途中按停止或關掉逐字稿，不會被當成記憶體不夠", async ({ page }) => {
  await fakeWorkers(page, { segments: SEGMENTS, punct: "hang" });
  await transcribe(page);
  await suggest(page);
  await expect(page.getByTestId("punct-status")).toHaveText(/^下載標點模型中…\d+%$/);
  expect(await page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBe("1");
  // 執行中不能重新轉
  await expect(page.getByRole("button", { name: "再轉一次" })).toBeDisabled();
  await page.getByRole("button", { name: "停止" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBeNull();
  await expect(page.getByRole("button", { name: "建議標點" })).toBeVisible();
  // 再按一次，這次直接關掉逐字稿
  await suggest(page);
  await expect(page.getByTestId("punct-status")).toHaveText(/^下載標點模型中/);
  await page.getByRole("button", { name: "取消" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBeNull();
});

test("標點建議：模型的內容對不上時說明下載失敗，逐字稿維持原文", async ({ page, guard }) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  // 辨識用假的，標點用真的 Worker
  await fakeWorkers(page, { segments: SEGMENTS });
  await transcribe(page);
  await suggest(page);
  await expect(page.getByTestId("punct-status")).toHaveText(/^下載標點模型失敗/, { timeout: 90_000 });
  await expect(page.getByTestId("transcript").locator("ins.punct-suggest")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "建議標點" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("gears-punct"))).toBeNull();
  // 只連到模型的目錄
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(DIR))).toBe(true);
  forgetRouted(guard);
});

test("建置產物裡沒有其他檔案匯入標點的 Worker 進入點", ({ browserName }) => {
  // WebKit 會把被匯入的 Worker 進入點當成另一份模組再執行一次，蓋掉 onmessage（見 transcribe.spec.ts 的同一項）。
  // 畫面用 ?worker&url 取得網址，那一處是字串、不算匯入
  test.skip(browserName !== "chromium");
  const assets = join(import.meta.dirname, "../../dist/assets");
  const offenders = readdirSync(assets).filter((f) => f.endsWith(".js") && !f.startsWith("punct.worker-") && /(import|from)\s*\(?\s*["'`][^"'`]*punct\.worker-[\w-]+\.js["'`]/.test(readFileSync(join(assets, f), "utf8")));
  expect(offenders).toEqual([]);
  expect(readdirSync(assets).some((f) => f.startsWith("punct.worker-"))).toBe(true);
});

// 約 1 分鐘的華語口語（每秒約 3.35 字，評測量到的朗讀速度），沒有標點，內容是自己寫的
const MINUTE = [
  "大家好今天想跟各位聊一下社群最近在做的事情",
  "我們這幾個月一直在整理文件站的內容",
  "很多人反映說第一次看的時候不知道要從哪裡開始",
  "所以我們把入門的部分重新寫過",
  "也加了幾個常見的情境",
  "比如說你在咖啡廳用公共網路的時候要注意什麼",
  "或是收到不明的檔案要怎麼先檢查",
  "另外工作台也多了逐字稿的功能",
  "你可以把訪談的錄音丟進去",
  "它會在你的瀏覽器裡面轉成文字",
  "錄音不會上傳到任何伺服器",
  "不過轉出來的文字常常沒有標點",
  "讀起來很吃力",
  "所以我們在測試一個標點的模型",
  "你們覺得這樣的功能有幫助嗎",
  "如果有興趣的話歡迎一起來試用",
  "有任何問題都可以在回饋的頁面告訴我們",
];

test("標點建議：真的下載與執行模型，補上標點，接受之後只多了標點", async ({ page, guard, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_PUNCT_MODEL !== "1", "真的下載模型（約 148 MB）要設 GEARS_PUNCT_MODEL=1");
  test.setTimeout(300_000);
  const segments = MINUTE.map((text, i) => ({ start: i * 3.5, end: i * 3.5 + 3.5, text }));
  await fakeWorkers(page, { segments });
  await transcribe(page);
  const original = await txt(page);
  const status = page.getByTestId("punct-status");
  // 第一次：下載加上執行
  let t0 = Date.now();
  await suggest(page);
  await expect(status).toHaveText(/^\d+ 段有建議的標點/, { timeout: 280_000 });
  const first = Date.now() - t0;
  const marks = await page.getByTestId("transcript").locator("ins.punct-suggest").allTextContents();
  expect(marks.length).toBeGreaterThan(5);
  expect(marks.every((m) => ["，", "。", "？"].includes(m))).toBe(true);
  // 第二次：模型已經在快取裡
  await page.getByRole("button", { name: "全部捨棄" }).click();
  t0 = Date.now();
  await suggest(page);
  await expect(status).toHaveText(/^\d+ 段有建議的標點/, { timeout: 120_000 });
  const cached = Date.now() - t0;
  await page.getByRole("button", { name: "全部接受" }).click();
  const accepted = await txt(page);
  // 只多了標點
  expect(accepted.replace(/[，。？]/g, "")).toBe(original);
  expect(accepted).toContain("？");
  testInfo.annotations.push({ type: "punct", description: `${MINUTE.join("").length} 字，第一次（含下載）${first} ms，已在快取 ${cached} ms` });
  console.log(`[punct] ${MINUTE.join("").length} 字，第一次（含下載）${first} ms，已在快取 ${cached} ms`);
  console.log(accepted);
  // 重新打開逐字稿：模型已經在快取裡，說明不寫下載量（punctStored 查的網址跟 Transformers.js 存的相同）
  await transcribe(page);
  await expect(page.getByTestId("punct-note")).toBeVisible();
  await expect(page.getByTestId("punct-note")).not.toContainText("MB");
  // 模型存在快取，「已下載的模型」另外列一列
  await page.goto("./storage/");
  await expect(page.getByText("逐字稿的標點模型")).toBeVisible();
  forgetRouted(guard);
});

test("標點建議：真的模型處理約 1 小時的逐字稿，分段算、只多了標點", async ({ page, guard, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_PUNCT_MODEL !== "1", "真的下載模型（約 148 MB）要設 GEARS_PUNCT_MODEL=1");
  test.setTimeout(600_000);
  // 約 12,000 字，評測量到的朗讀速度（每秒 3.35 字）約 1 小時
  const texts = Array.from({ length: 48 }, () => MINUTE).flat();
  const segments = texts.map((text, i) => ({ start: i * 3.5, end: i * 3.5 + 3.5, text }));
  await fakeWorkers(page, { segments });
  await transcribe(page);
  const original = await txt(page);
  const status = page.getByTestId("punct-status");
  // 先下載好模型，第二次才量分段處理的時間
  await suggest(page);
  await expect(status).toHaveText(/^\d+ 段有建議的標點/, { timeout: 400_000 });
  await page.getByRole("button", { name: "全部捨棄" }).click();
  const seen = new Set<string>();
  const t0 = Date.now();
  await suggest(page);
  // 記下看到的進度，確認是一段一段算的
  while (!/段有建議的標點/.test((await status.textContent()) ?? "")) {
    seen.add((await status.textContent()) ?? "");
    await page.waitForTimeout(200);
    expect(Date.now() - t0).toBeLessThan(300_000);
  }
  const elapsed = Date.now() - t0;
  expect([...seen].filter((s) => /分析中…\d+%/.test(s)).length).toBeGreaterThan(2);
  await page.getByRole("button", { name: "全部接受" }).click();
  const accepted = await txt(page);
  expect(accepted.replace(/[，。？]/g, "")).toBe(original);
  const chars = texts.join("").length;
  testInfo.annotations.push({ type: "punct", description: `${chars} 字、${segments.length} 段，已在快取 ${elapsed} ms` });
  console.log(`[punct] ${chars} 字、${segments.length} 段，已在快取 ${elapsed} ms，看到的進度：${[...seen].join(" / ")}`);
  forgetRouted(guard);
});

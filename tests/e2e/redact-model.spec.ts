import type { Page } from "@playwright/test";
import { assetsUrl } from "../../src/core/models.ts";
import { PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import { type Guard, expect, test } from "./guard.ts";

// 遮蔽的「找人名、地址與單位」（#187，src/ui/pii-detect.ts）。模型從 assets.anoni.net 下載：
// 一般的測試攔下來、回內容不對的檔案，確認會停下來。真的下載與載入只在本機的 Chromium、設了 GEARS_PII_MODEL=1 時
// 執行（約 200 MB，CI 不執行：assets.anoni.net 連不上時會擋住部署）。從測試裡攔下再回 194 MB 的檔案太慢
// （2026-11-21 試過，200 秒還在下載），所以那一項讓請求直接出去

const DIR = assetsUrl(PII_MODEL.dir, "");

// 白底黑字的截圖，英文與數字（CI 沒有中文字型）：一個人名、一個公司、一支電話
async function screenshot(page: Page) {
  const data = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 360;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    g.font = "48px sans-serif";
    g.fillText("Meet Kevin Lin tomorrow", 40, 90);
    g.fillText("He works at Acme Trading Co.", 40, 190);
    g.fillText("Call 0912-345-678", 40, 290);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  return Buffer.from(data);
}

async function openRedact(page: Page) {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: await screenshot(page) });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
}

// 按下「找人名、地址與單位」。手機與平板（iPhone 那個 project）先展開說明，按「仍要使用」才開始
async function startModel(page: Page) {
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  const ask = page.getByTestId("redact-model-ask");
  if (await ask.isVisible()) await ask.getByRole("button", { name: "仍要使用" }).click();
}

const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

test("找人名、地址與單位：還沒下載時寫出大小與手機記憶體的提醒，模型的內容對不上時停下來", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await openRedact(page);
  // 手機上的提醒寫在按下之後的說明裡（見最後一項測試），上方的說明只給電腦
  if (testInfo.project.name === "iphone") await expect(page.getByTestId("redact-model-note")).toHaveCount(0);
  else {
    await expect(page.getByTestId("redact-model-note")).toContainText("約 200 MB");
    await expect(page.getByTestId("redact-model-note")).toContainText("暫存區會跟著清空");
  }
  await startModel(page);
  await expect(page.getByTestId("redact-auto-status")).toHaveText("沒有辦法執行自動尋找，請手動框選。", { timeout: 90_000 });
  // 只連到模型的目錄
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(DIR))).toBe(true);
  forgetRouted(guard);
});

test("找人名、地址與單位：上一次做到一半頁面重新載入了，說明原因，這個分頁不再提供按鈕", async ({ page }) => {
  // 記號在首頁設下、重新載入之後從桌面點進遮蔽也讀得到（同一個分頁）
  await page.goto("./");
  await page.evaluate(() => sessionStorage.setItem("gears-pii-redact", "1"));
  await page.reload();
  // 桌面的工具連結只換到工具頁，選檔案由讀者在工具頁按下（不自動打開系統的選檔案視窗）
  await page.getByRole("link", { name: /截圖上的名字與電話/ }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.locator(".intro").getByRole("button", { name: "選擇檔案" }).click()]);
  await chooser.setFiles({ name: "chat.png", mimeType: "image/png", buffer: await screenshot(page) });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByTestId("redact-model-crashed")).toContainText("記憶體不夠");
  await expect(page.getByRole("button", { name: "找人名、地址與單位" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "找電話、Email 等個資" })).toBeVisible();
  // 關掉遮蔽（沒有執行模型）不會清掉記號，從檔案畫面再打開一次，按鈕仍然不出現
  await page.getByRole("button", { name: "取消" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("gears-pii-redact"))).toBe("1");
  await page.getByRole("button", { name: "打開遮蔽" }).click();
  await expect(page.getByTestId("redact-model-crashed")).toContainText("記憶體不夠");
  await expect(page.getByRole("button", { name: "找人名、地址與單位" })).toHaveCount(0);
});

test("找人名、地址與單位：下載途中按取消，不會被當成記憶體不夠", async ({ page, guard }) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  // 模型的請求一直不回應，停在下載中
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
  });
  await openRedact(page);
  await startModel(page);
  await expect(page.getByTestId("redact-auto-status")).toHaveText(/開源本機模型中/, { timeout: 90_000 });
  await page.getByRole("button", { name: "取消" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("gears-pii-redact"))).toBeNull();
  forgetRouted(guard);
});

// 分成另一項：同一個測試裡換頁時，WebKit 會在主控台留下暫存區縮圖的 blob: 被擋下的錯誤（2026-11-21 CI 的 iPhone）
test("找人名、地址與單位：沒有文字的圖不下載模型", async ({ page }) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  page.on("request", (r) => r.url().startsWith(DIR) && asked.push(r.url()));
  await page.goto("./redact/");
  const blank = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 400, 200);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId("file-input").setInputFiles({ name: "blank.png", mimeType: "image/png", buffer: Buffer.from(blank) });
  await startModel(page);
  await expect(page.getByTestId("redact-auto-status")).toHaveText("沒有找到。自動尋找會漏掉，請自己再看一次整張圖。", { timeout: 90_000 });
  expect(asked).toEqual([]);
});

test("找人名、地址與單位：辨識文字之後交給模型，人名與公司另外加上框，已下載的模型多一列", async ({ page, guard, browserName }) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_PII_MODEL !== "1", "真的下載模型（約 200 MB）要設 GEARS_PII_MODEL=1");
  test.setTimeout(240_000);
  await openRedact(page);
  await startModel(page);
  const status = page.getByTestId("redact-auto-status");
  await expect(status).toHaveText(/^加了 \d+ 個框/, { timeout: 200_000 });
  // 規則找到電話，模型另外找到人名與公司
  const n = Number((await status.textContent())!.match(/加了 (\d+) 個框/)![1]);
  expect(n).toBeGreaterThanOrEqual(3);
  // 模型存在快取，「已下載的模型」另外列一列。下次打開遮蔽時不再寫下載量（下載完之後不重算，照原本的下載說明）
  await page.getByRole("button", { name: "取消" }).click();
  await page.goto("./storage/");
  await expect(page.getByText("找人名、地址與單位的模型")).toBeVisible();
  forgetRouted(guard);
});

test("找人名、地址與單位：手機上先說明還在測試，可以先去協助測試頁量測，電腦上直接開始", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  await page.context().route(`${DIR}**`, (route) => route.fulfill({ status: 200, body: "not the model" }));
  await openRedact(page);
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  const ask = page.getByTestId("redact-model-ask");
  if (testInfo.project.name !== "iphone") {
    await expect(ask).toHaveCount(0);
    await expect(page.getByTestId("redact-auto-status")).toHaveText("沒有辦法執行自動尋找，請手動框選。", { timeout: 90_000 });
    forgetRouted(guard);
    return;
  }
  await expect(ask).toContainText("在手機與平板上還在測試");
  await expect(ask).toContainText("約 200 MB");
  // 還沒開始：沒有進度，也沒有下載
  await expect(page.getByTestId("redact-auto-progress")).toHaveCount(0);
  await ask.getByRole("link", { name: "先幫忙量測" }).click();
  await expect(page).toHaveURL(/\/testing\/$/);
  await expect(page.getByTestId("testing-phone")).toBeVisible();
  forgetRouted(guard);
});

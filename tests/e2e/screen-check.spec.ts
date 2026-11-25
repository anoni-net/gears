import type { Page } from "@playwright/test";
import { assetsUrl } from "../../src/core/models.ts";
import { PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import { type Guard, expect, test } from "./guard.ts";

// 檔案畫面的「檢查畫面內容」（src/ui/ScreenCheck.tsx）：找人臉與辨識文字跟遮蔽的自動尋找同一套，
// 找到的框交給遮蔽放好

// 白底黑字的截圖：一行電話、一行 Email、一行一般的文字。英文與數字，CI 沒有中文字型。
// names 換成有人名與公司的版本，給個資辨識模型的測試用
async function screenshot(page: Page, withText: boolean, names = false) {
  const data = await page.evaluate(async ([text, names]) => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 360;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    if (text) {
      g.fillStyle = "#000";
      g.font = "48px sans-serif";
      g.fillText("Call 0912-345-678", 40, 90);
      g.fillText(names ? "Meet Kevin Lin tomorrow" : "jane.doe@example.org", 40, 190);
      g.fillText(names ? "He works at Acme Trading Co." : "See you tomorrow", 40, 290);
    }
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, [withText, names] as const);
  return Buffer.from(data);
}

async function addScreenshot(page: Page, withText: boolean, names = false) {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: await screenshot(page, withText, names) });
  await expect(page.getByTestId("screen-check")).toBeVisible();
}

test("找到電話與 Email，打開遮蔽時框已經放好，套用之後成為新的版本", async ({ page }) => {
  test.setTimeout(120_000);
  await addScreenshot(page, true);
  await expect(page.getByTestId("screen-download")).toHaveText("第一次檢查要下載約 40 MB 的辨識模型，之後存在這台裝置的瀏覽器裡。");
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  const status = page.getByTestId("screen-status");
  // 類別看辨識出的文字，Email 偶爾被讀成帳號，只確認電話與兩筆的數量
  await expect(status).toHaveText(/^找到：電話號碼 1 處、.+ 1 處。自動尋找會漏掉，交出去之前請自己再看一次整張圖。$/, { timeout: 90_000 });
  // 只列數量，不在檔案畫面列出找到的文字
  await expect(page.getByTestId("screen-check")).not.toContainText("0912");

  await page.getByRole("button", { name: "打開遮蔽，框已經放好" }).click();
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("已經放好檢查畫面內容時找到的 2 個框，請逐一確認，框錯的點一下就會拿掉。");
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByTestId("history-current").getByText("遮蔽", { exact: true })).toBeVisible();
});

test("沒有找到時用灰色說明會漏，不出現打開遮蔽的按鈕", async ({ page }) => {
  test.setTimeout(120_000);
  await addScreenshot(page, false);
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  const status = page.getByTestId("screen-status");
  await expect(status).toHaveText("沒有找到人臉與電話、Email 這類個資。自動尋找會漏掉，交出去之前請自己再看一次整張圖。", { timeout: 90_000 });
  await expect(status).toHaveClass("hint");
  await expect(page.getByRole("button", { name: "打開遮蔽，框已經放好" })).toHaveCount(0);
  // 沒有讀到文字，不提供找人名、地址與單位
  await expect(page.getByTestId("screen-model")).toHaveCount(0);
});

test("檢查找到的框不會帶進之後從工具列打開的遮蔽", async ({ page }) => {
  test.setTimeout(120_000);
  await addScreenshot(page, true);
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  await expect(page.getByTestId("screen-status")).toContainText("找到：", { timeout: 90_000 });
  await page.getByRole("button", { name: "打開遮蔽，框已經放好" }).click();
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  // 工具列的遮蔽：一般的打開方式，沒有預先放好的框
  await page.getByRole("button", { name: "打開遮蔽" }).click();
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("側臉、戴口罩的臉、小字與手寫字常會漏掉，套用之前請自己再檢查一次。");
});

// --- 找人名、地址與單位（個資辨識模型，#187）。模型從 assets.anoni.net 下載，一般的測試攔下來、回內容不對的檔案。
// 真的下載只在本機的 Chromium、設了 GEARS_PII_MODEL=1 時執行（約 200 MB，理由見 redact-model.spec.ts）

const DIR = assetsUrl(PII_MODEL.dir, "");
const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

async function checkScreen(page: Page) {
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  await expect(page.getByTestId("screen-status")).toContainText("找到：", { timeout: 90_000 });
}

test("找人名、地址與單位：檢查之後才出現，模型的內容對不上時說明，規則的結果留著", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await addScreenshot(page, true);
  // 「檢查畫面內容」不會一起下載模型
  await expect(page.getByTestId("screen-model")).toHaveCount(0);
  await checkScreen(page);
  expect(asked).toEqual([]);
  const status = page.getByTestId("screen-status");
  const before = await status.textContent();
  // 手機上的下載量寫在按下之後的說明裡，按鈕上方的說明只給電腦
  if (testInfo.project.name === "iphone") await expect(page.getByTestId("screen-model-note")).toHaveCount(0);
  else await expect(page.getByTestId("screen-model-note")).toContainText("約 200 MB");
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  const ask = page.getByTestId("screen-model-ask");
  if (testInfo.project.name === "iphone") {
    await expect(ask).toContainText("在手機與平板上還在測試");
    await ask.getByRole("button", { name: "仍要使用" }).click();
  } else await expect(ask).toHaveCount(0);
  await expect(page.getByTestId("screen-model-status")).toHaveText("沒有辦法執行開源本機模型，可能是下載中斷，可以再按一次「找人名、地址與單位」。上面的結果不受影響，人名與地址請自己看一次。", {
    timeout: 90_000,
  });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(DIR))).toBe(true);
  await expect(status).toHaveText(before!);
  await expect(page.getByRole("button", { name: "打開遮蔽，框已經放好" })).toBeEnabled();
  // 做完或失敗之後記號清掉，下次不會被當成記憶體不夠
  expect(await page.evaluate(() => sessionStorage.getItem("gears-pii-redact"))).toBeNull();
  // 可以再試一次
  await expect(page.getByRole("button", { name: "找人名、地址與單位" })).toBeVisible();
  forgetRouted(guard);
});

test("找人名、地址與單位：下載途中按停止，回到可以再按一次的狀態", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  // 模型的請求一直不回應，停在下載中
  await page.context().route(`${DIR}**`, () => {});
  await addScreenshot(page, true);
  await checkScreen(page);
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  if (testInfo.project.name === "iphone") await page.getByTestId("screen-model-ask").getByRole("button", { name: "仍要使用" }).click();
  await expect(page.getByTestId("screen-model-status")).toHaveText(/開源本機模型中/);
  await expect(page.getByTestId("screen-model").getByRole("progressbar")).toBeVisible();
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByRole("button", { name: "找人名、地址與單位" })).toBeVisible();
  await expect(page.getByTestId("screen-model-status")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("gears-pii-redact"))).toBeNull();
  forgetRouted(guard);
});

test("找人名、地址與單位：上一次做到一半頁面重新載入了，說明原因，不出現按鈕", async ({ page }) => {
  test.setTimeout(120_000);
  // 記號跟遮蔽共用：同一個模型、同一台裝置
  await page.goto("./");
  await page.evaluate(() => sessionStorage.setItem("gears-pii-redact", "1"));
  await addScreenshot(page, true);
  await checkScreen(page);
  await expect(page.getByTestId("screen-model-crashed")).toContainText("記憶體不夠");
  await expect(page.getByRole("button", { name: "找人名、地址與單位" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打開遮蔽，框已經放好" })).toBeVisible();
});

test("找人名、地址與單位：人名與公司列進數量，框一起交給遮蔽", async ({ page, guard, browserName }) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_PII_MODEL !== "1", "真的下載模型（約 200 MB）要設 GEARS_PII_MODEL=1");
  test.setTimeout(240_000);
  await addScreenshot(page, true, true);
  await checkScreen(page);
  await expect(page.getByTestId("screen-status")).toHaveText(/^找到：電話號碼 1 處。/);
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  await expect(page.getByTestId("screen-model-status")).toHaveText(/^開源本機模型另外找到 \d+ 處/, { timeout: 200_000 });
  await expect(page.getByTestId("screen-status")).toHaveText(/^找到：電話號碼 1 處、人名 \d+ 處、單位名稱 \d+ 處/);
  // 只列數量，不列找到的文字
  await expect(page.getByTestId("screen-check")).not.toContainText("Kevin");
  await page.getByRole("button", { name: "打開遮蔽，框已經放好" }).click();
  await expect(page.getByTestId("redact-auto-status")).toHaveText(/^已經放好檢查畫面內容時找到的 [3-9] 個框/);
  forgetRouted(guard);
});

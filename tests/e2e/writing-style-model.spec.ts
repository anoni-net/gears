import type { Page } from "@playwright/test";
import { assetsUrl } from "../../src/core/models.ts";
import { PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import { type Guard, expect, test } from "./guard.ts";

// 寫作習慣檢查的「找人名、地址與單位」（#143，src/ui/StyleModel.tsx）。模型從 assets.anoni.net 下載：
// 一般的測試攔下來、回內容不對的檔案。真的下載與執行只在本機的 Chromium、設了 GEARS_PII_MODEL=1 時執行，
// 照遮蔽的 redact-model.spec.ts

const DIR = assetsUrl(PII_MODEL.dir, "");
const TEXT = "Meet Kevin Lin tomorrow. He works at Acme Trading Co. and Kevin Lin will bring the files.";

async function open(page: Page) {
  await page.goto("./writing-style/");
  await page.getByLabel("要交出去的文字").fill(TEXT);
  await expect(page.getByTestId("style-model")).toBeVisible();
}

// 手機與平板（iPhone 那個 project）先展開說明，按「仍要使用」才開始
async function start(page: Page) {
  const section = page.getByTestId("style-model");
  await section.getByRole("button", { name: "找人名、地址與單位" }).click();
  const ask = page.getByTestId("style-model-ask");
  if (await ask.isVisible()) await ask.getByRole("button", { name: "仍要使用" }).click();
}

const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

test("寫作習慣檢查：模型的內容對不上時說明，規則的結果照樣可以用", async ({ page, guard }, testInfo) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await open(page);
  if (testInfo.project.name === "iphone") await expect(page.getByTestId("style-model-note")).toHaveCount(0);
  else await expect(page.getByTestId("style-model-note")).toContainText("約 200 MB");
  await start(page);
  await expect(page.getByTestId("style-model-status")).toContainText("沒有辦法執行開源本機模型", { timeout: 90_000 });
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(DIR))).toBe(true);
  // 執行完記號清掉，可以再按一次
  expect(await page.evaluate(() => sessionStorage.getItem("gears-pii-redact"))).toBeNull();
  await expect(page.getByTestId("style-model").getByRole("button", { name: "找人名、地址與單位" })).toBeVisible();
  forgetRouted(guard);
});

test("寫作習慣檢查：上一次用模型時頁面重新載入了，說明原因、不出現按鈕", async ({ page }) => {
  await page.goto("./writing-style/");
  // 工具的程式載入完才重新載入，WebKit 在載入中途重新載入時，主控台會留下模組載入失敗
  await expect(page.getByLabel("要交出去的文字")).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("gears-pii-redact", "1"));
  await page.reload();
  await page.getByLabel("要交出去的文字").fill(TEXT);
  await expect(page.getByTestId("style-model-crashed")).toContainText("記憶體不夠");
  await expect(page.getByTestId("style-model").getByRole("button", { name: "找人名、地址與單位" })).toHaveCount(0);
});

test("寫作習慣檢查：手機上先說明還在測試，電腦上直接開始", async ({ page, guard }, testInfo) => {
  await page.context().route(`${DIR}**`, (route) => route.fulfill({ status: 200, body: "not the model" }));
  await open(page);
  await page.getByTestId("style-model").getByRole("button", { name: "找人名、地址與單位" }).click();
  if (testInfo.project.name === "iphone") {
    await expect(page.getByTestId("style-model-ask")).toContainText("貼上的文字會跟著消失");
    await expect(page.getByTestId("style-model-ask").getByRole("link", { name: "先幫忙量測" })).toBeVisible();
  } else await expect(page.getByTestId("style-model-ask")).toHaveCount(0);
  forgetRouted(guard);
});

test("寫作習慣檢查：模型找到人名與公司，逐項換成代稱", async ({ page, guard, browserName }) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_PII_MODEL !== "1", "真的下載模型（約 200 MB）要設 GEARS_PII_MODEL=1");
  test.setTimeout(240_000);
  await open(page);
  await start(page);
  await expect(page.getByTestId("style-model-status")).toContainText("開源本機模型找到", { timeout: 200_000 });
  const terms = page.getByTestId("style-model-terms");
  await expect(terms).toContainText("Kevin Lin");
  await terms.getByRole("button", { name: /^把「Kevin Lin」換成/ }).click();
  const input = page.getByLabel("要交出去的文字");
  await expect(input).not.toHaveValue(/Kevin Lin/);
  await expect(input).toHaveValue(/〔人名 A〕/);
  // 換掉的那一項不再列出
  await expect(terms).not.toContainText("Kevin Lin");
  forgetRouted(guard);
});

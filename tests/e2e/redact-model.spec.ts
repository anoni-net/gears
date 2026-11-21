import type { Page } from "@playwright/test";
import { assetsUrl } from "../../src/core/models.ts";
import { PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import { type Guard, expect, test } from "./guard.ts";

// 遮蔽的「找人名、地址與單位」（#187，src/ui/pii-detect.ts）。模型從 assets.anoni.net 下載：
// 一般的測試攔下來、回內容不對的檔案，確認會停下來。真的下載與載入只在 Chromium、設了 GEARS_PII_MODEL=1 時執行
// （CI 的 Chromium 那台），約 200 MB 經過 Cloudflare 的快取。從測試裡攔下再回 194 MB 的檔案太慢（2026-11-21 試過，
// 200 秒還在下載），所以那一項讓請求直接出去

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

const forgetRouted = (guard: Guard) => {
  guard.requests = guard.requests.filter((url) => !url.startsWith(DIR));
};

test("找人名、地址與單位：還沒下載時寫出大小與手機記憶體的提醒，模型的內容對不上時停下來", async ({ page, guard }) => {
  test.setTimeout(120_000);
  const asked: string[] = [];
  await page.context().route(`${DIR}**`, (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, body: "not the model" });
  });
  await openRedact(page);
  await expect(page.getByTestId("redact-model-note")).toContainText("約 200 MB");
  await expect(page.getByTestId("redact-model-note")).toContainText("暫存區會跟著清空");
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("沒有辦法執行自動尋找，請手動框選。", { timeout: 90_000 });
  // 只連到模型的目錄
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => url.startsWith(DIR))).toBe(true);
  forgetRouted(guard);
});

test("找人名、地址與單位：上一次做到一半頁面重新載入了，說明原因，這個分頁不再提供按鈕", async ({ page }) => {
  await page.goto("./redact/");
  await page.evaluate(() => history.replaceState({ ...(history.state ?? {}), gearsPiiRedact: true }, ""));
  await page.reload();
  await page.getByTestId("file-input").setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: await screenshot(page) });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByTestId("redact-model-crashed")).toContainText("記憶體不夠");
  await expect(page.getByRole("button", { name: "找人名、地址與單位" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "找電話、Email 等個資" })).toBeVisible();
});

test("找人名、地址與單位：辨識文字之後交給模型，人名與公司另外加上框，已下載的模型多一列", async ({ page, guard, browserName }) => {
  test.skip(browserName !== "chromium", "真的模型只在 Chromium 載入");
  test.skip(process.env.GEARS_PII_MODEL !== "1", "真的下載模型（約 200 MB）要設 GEARS_PII_MODEL=1");
  test.setTimeout(240_000);
  await openRedact(page);
  await page.getByRole("button", { name: "找人名、地址與單位" }).click();
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

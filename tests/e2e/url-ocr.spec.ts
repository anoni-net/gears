import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 從截圖讀出網址：網址檢查的入口（src/ui/UrlFromScreenshot.tsx）與檔案畫面的「畫面上的網址」（src/ui/ScreenCheck.tsx）。
// 文字辨識是真的 PP-OCR（CI 用 fetch-whisper.mjs ppocr 下載模型），截圖用 canvas 畫：白底黑字、字放大，
// 只用英數（CI 沒有中文字型），網址避開 l、1、I、O、0 這類各引擎可能讀得不一樣的字

const LIST = "# from=2025-12 to=2026-09 count=1\nscam-shop.cc\n";
const URL_A = "https://secure-pay.test/verify";
const URL_B = "shop.test/deals";

test.beforeEach(async ({ page }) => {
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: LIST, contentType: "text/plain" }));
});

async function screenshot(page: Page, lines: string[]) {
  const data = await page.evaluate(async (texts) => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 120 + texts.length * 100;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#000";
    g.font = "48px sans-serif";
    texts.forEach((text, i) => g.fillText(text, 40, 90 + i * 100));
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, lines);
  return { name: "chat.png", mimeType: "image/png", buffer: Buffer.from(data) };
}
const WITH_URLS = ["Pay here " + URL_A, "or see " + URL_B, "See you tomorrow"];

// 按「從截圖讀出網址」，系統的選檔案視窗出現時選這張截圖
async function pickScreenshot(page: Page, lines: string[]) {
  const file = await screenshot(page, lines);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "從截圖讀出網址" }).click()]);
  await chooser.setFiles(file);
}

test("選一張新的截圖：放進暫存區，列出網址與裁切小圖，修改之後檢查", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./url-check/");
  await expect(page.getByTestId("url-ocr-download")).toHaveText("第一次讀截圖要下載約 40 MB 的辨識模型，之後存在這台裝置的瀏覽器裡。");
  await pickScreenshot(page, WITH_URLS);
  const found = page.getByTestId("url-ocr-found");
  await expect(found).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "截圖上的網址" })).toBeVisible();
  await expect(found.locator(".callout.warn")).toContainText("l 與 1");
  await expect(page.getByLabel("讀出的網址（第 1 個）")).toHaveValue(URL_A);
  await expect(page.getByLabel("讀出的網址（第 2 個）")).toHaveValue(URL_B);
  // 每個網址一張裁切小圖，是截圖上的那一塊
  await expect(page.getByRole("img", { name: "截圖上第 1 個網址的位置" })).toBeVisible();
  await expect(page.getByRole("img", { name: "截圖上第 2 個網址的位置" })).toBeVisible();
  // 新選的截圖放進暫存區
  await expect(page.locator(".tray").getByText("chat.png")).toBeVisible();

  // 讀錯的地方可以直接改，檢查時用改過的
  await page.getByLabel("讀出的網址（第 2 個）").fill(`${URL_B}?utm_source=line`);
  await page.getByRole("button", { name: "檢查這個網址" }).nth(1).click();
  await expect(page.getByLabel("要檢查的網址")).toHaveValue(`${URL_B}?utm_source=line`);
  await expect(page.getByText("行銷活動的追蹤標籤（UTM）")).toBeVisible();
  await expect(page.getByTestId("clean-url")).toHaveText("https://shop.test/deals");
  await expect(page.getByTestId("url-result")).toBeFocused();
});

test("暫存區已經有圖片時可以直接用，不會再放一份", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles(await screenshot(page, WITH_URLS));
  await expect(page.getByTestId("screen-check")).toBeVisible();
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByRole("link", { name: /網址檢查/ }).click();
  await expect(page).toHaveURL(/\/gears\/url-check\/$/);
  let chooser = false;
  page.on("filechooser", () => (chooser = true));
  await page.getByRole("button", { name: "從截圖讀出網址" }).click();
  await expect(page.getByRole("heading", { name: "要讀的截圖" })).toBeVisible();
  await page.getByRole("button", { name: "讀這張：chat.png" }).click();
  await expect(page.getByLabel("讀出的網址（第 1 個）")).toHaveValue(URL_A, { timeout: 90_000 });
  expect(chooser).toBe(false);
  await expect(page.locator(".tray li")).toHaveCount(1);
});

test("沒有找到網址時用灰色說明自動辨識會漏", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./url-check/");
  await pickScreenshot(page, ["See you tomorrow"]);
  const status = page.getByTestId("url-ocr-status");
  await expect(status).toHaveText("沒有在截圖上找到網址。自動辨識會漏掉，請自己看一次截圖，看到網址時打進上面的輸入框。", { timeout: 90_000 });
  await expect(status).toHaveClass("hint");
  await expect(page.getByTestId("url-ocr-found")).toHaveCount(0);
});

test("檢查收到的截圖：檔案畫面列出畫面上的網址、複製讀出的文字、交給網址檢查", async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    // 記下複製的文字，不碰真的剪貼簿
    const w = window as unknown as { copied: string[] };
    w.copied = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void w.copied.push(text) }, configurable: true });
  });
  await page.goto("./url-check/");
  // 從網址檢查放進來的截圖，目的記成檢查收到的
  await pickScreenshot(page, WITH_URLS);
  await expect(page.getByTestId("url-ocr-found")).toBeVisible({ timeout: 90_000 });
  await page.locator(".tray").getByText("chat.png").click();
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  const urls = page.getByTestId("screen-urls");
  await expect(urls).toBeVisible({ timeout: 90_000 });
  await expect(urls.getByRole("heading", { name: "畫面上的網址" })).toBeVisible();
  await expect(urls.getByLabel("讀出的網址（第 1 個）")).toHaveValue(URL_A);
  await urls.getByRole("button", { name: "複製讀出的文字" }).click();
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  expect(copied).toHaveLength(1);
  expect(copied[0]).toContain("secure-pay.test");
  expect(copied[0]).toContain("See you tomorrow");
  await urls.getByRole("button", { name: "檢查這個網址" }).first().click();
  await expect(page).toHaveURL(/\/gears\/url-check\/$/);
  await expect(page.getByLabel("要檢查的網址")).toHaveValue(URL_A);
  await expect(page.getByText("真正的網域是 secure-pay.test")).toBeVisible();
});

test("交出去之前的照片：檔案畫面只列數量，不列網址與文字", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./strip-metadata/");
  await page.getByTestId("file-input").setInputFiles(await screenshot(page, WITH_URLS));
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  await expect(page.getByTestId("screen-status")).toContainText("網址", { timeout: 90_000 });
  await expect(page.getByTestId("screen-urls")).toHaveCount(0);
  await expect(page.getByTestId("screen-check")).not.toContainText("secure-pay");
  await expect(page.getByRole("button", { name: "複製讀出的文字" })).toHaveCount(0);
});

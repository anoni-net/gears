import type { Page } from "@playwright/test";
import { MODEL_CATALOG, catalogRange } from "../../src/core/model-catalog.ts";
import { formatSize } from "../../src/core/storage.ts";
import { expect, test } from "./guard.ts";

// 設計原則（src/ui/AboutPage.tsx）：桌面兩段說明的「了解更多」捲到對應段落，使用者區、左欄與頁尾都連得到，
// 模型表跟 src/core/model-catalog.ts 一致，即時檢查依瀏覽器的狀況寫出結果與說明

// 頁面有沒有重新載入：在 window 上留一個記號，重新載入之後就不見了
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { gearsMark: number }).gearsMark = 1));
const marked = (page: Page) => page.evaluate(() => (window as unknown as { gearsMark?: number }).gearsMark === 1);

// 小標題的上緣在畫面的上半部（捲到那一段了）
async function scrolledTo(page: Page, id: string) {
  await expect.poll(async () => page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(200);
  await expect.poll(async () => page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-2);
}

for (const [label, id] of [
  ["瀏覽器裡就能完成", "browser"],
  ["用開源本機模型加強", "models"],
] as const) {
  test(`桌面「${label}」的了解更多捲到設計原則的那一段，不重新載入`, async ({ page }) => {
    await page.goto("./");
    await mark(page);
    await page.getByRole("link", { name: `了解更多：${label}` }).click();
    await expect(page).toHaveURL(new RegExp(`/about/#${id}$`));
    await expect(page.getByRole("heading", { level: 1, name: "設計原則" })).toBeVisible();
    await scrolledTo(page, id);
    await expect(page.locator(`#${id}`)).toBeFocused();
    expect(await marked(page)).toBe(true);
  });
}

test("直接打開帶 # 的網址也捲到那一段", async ({ page }) => {
  await page.goto("./about/#tradeoffs");
  await scrolledTo(page, "tradeoffs");
});

test("使用者區的第一個是設計原則，頁尾也連得到", async ({ page }) => {
  await page.goto("./");
  const user = page.locator(".desk-user").getByRole("link");
  await expect(user.first()).toHaveText("設計原則");
  await user.first().click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "設計原則" })).toBeVisible();

  await page.goto("./privacy/");
  await page.getByTestId("about-link").click();
  await expect(page).toHaveURL(/\/about\/$/);
  await expect(page.getByTestId("about")).toBeVisible();
});

test("寬螢幕的左欄列出設計原則，本頁目錄有每一段", async ({ page, isMobile }) => {
  test.skip(isMobile, "手機上不顯示左欄");
  await page.goto("./about/");
  const pages = page.getByTestId("aside-pages");
  await expect(pages.getByRole("link", { name: "設計原則" })).toHaveAttribute("aria-current", "page");
  const toc = page.getByTestId("aside-toc").getByRole("link");
  await expect(toc).toContainText(["瀏覽器裡的工作台", "開源本機模型", "由你確認的模型結果", "代價與取捨", "你的瀏覽器現在的狀態", "延伸閱讀"]);
});

test("模型表的列與 model-catalog 一致，授權連到授權與來源的那一項", async ({ page }) => {
  await page.goto("./about/");
  const rows = page.getByTestId("about-models").locator("tbody tr");
  await expect(rows).toHaveCount(MODEL_CATALOG.length);
  for (const [i, m] of MODEL_CATALOG.entries()) {
    const row = rows.nth(i);
    await expect(row).toHaveAttribute("data-model", m.id);
    await expect(row.locator("th a")).toHaveText(m.name);
    await expect(row.locator("th a")).toHaveAttribute("href", m.source);
    await expect(row.locator("td").nth(1)).toHaveText(m.license);
    await expect(row.locator("td").nth(2)).toHaveText(formatSize(m.bytes));
  }
  const { min, max } = catalogRange();
  await expect(page.getByTestId("about-range")).toContainText(`${min.name}（${formatSize(min.bytes)}）`);
  await expect(page.getByTestId("about-range")).toContainText(`${max.name}（${formatSize(max.bytes)}）`);

  await rows.first().locator("td").nth(1).getByRole("link").click();
  await expect(page).toHaveURL(/\/licenses\/#licenses-redact-detect$/);
  await scrolledTo(page, "licenses-redact-detect");
});

test("延伸閱讀連到隱私說明、授權與來源、已下載的模型、協助測試與原始碼", async ({ page }) => {
  await page.goto("./about/");
  const more = page.getByTestId("about-more").getByRole("link");
  await expect(more).toHaveText(["隱私說明", "授權與來源", "已下載的模型", "協助測試", "原始碼（GitHub）"]);
  await expect(more.last()).toHaveAttribute("href", "https://github.com/anoni-net/gears");
  await more.nth(3).click();
  await expect(page).toHaveURL(/\/testing\/$/);
});

test("即時檢查：沒有下載過模型、可以用 WebAssembly，每一項都有說明", async ({ page }) => {
  await page.goto("./about/");
  const status = page.getByTestId("about-status");
  // 測試擋掉 service worker（playwright.config.ts），還沒準備好
  await expect(status.getByTestId("about-status-offline")).toHaveAttribute("data-state", "pending");
  await expect(status.getByTestId("about-status-offline")).toContainText("還沒準備好。");
  await expect(status.getByTestId("about-status-models")).toHaveAttribute("data-state", "none");
  await expect(status.getByTestId("about-status-models")).toContainText("還沒有下載任何模型。模型第一次用到時才下載。");
  await expect(status.getByTestId("about-status-wasm")).toHaveAttribute("data-state", "yes");
  await expect(status.getByTestId("about-status-wasm")).toContainText("可以執行模型。");
  await expect(status.getByTestId("about-status-gpu")).not.toHaveAttribute("data-state", "checking");
  await expect(status.getByTestId("about-status-gpu").getByRole("link", { name: "這台裝置的詳細狀況" })).toBeVisible();
  for (const id of ["offline", "models", "wasm", "gpu"]) await expect(status.getByTestId(`about-status-${id}`).locator("strong")).not.toBeEmpty();
});

test("即時檢查：下載過的模型依已下載的模型的分類列出，執行環境不算模型", async ({ page }) => {
  // 先在桌面放好快取，再從使用者區換頁（WebKit 重新載入之後讀不到測試裡放進去的快取，照 storage.spec.ts 的做法）
  await page.goto("./");
  await page.evaluate(async () => {
    const put = async (cache: string, path: string) => (await caches.open(cache)).put(path, new Response(new Uint8Array(10)));
    await put("gears-keep", "/gears/models/yunet-2023mar-dynamic.onnx");
    await put("gears-keep", "/gears/assets/ort-wasm-simd-threaded.wasm");
    await put("gears-models", "/gears/models/speaker/campplus.onnx");
  });
  await page.locator(".desk-user").getByRole("link", { name: "設計原則" }).click();
  const models = page.getByTestId("about-status-models");
  await expect(models).toHaveAttribute("data-state", "some");
  await expect(models).toContainText("已經下載 2 個模型。");
  await expect(models.getByTestId("about-status-model-list").locator("li")).toHaveText(["分辨說話者的模型", "找人臉的模型"]);
  await models.getByRole("link", { name: "已下載的模型" }).click();
  await expect(page).toHaveURL(/\/storage\/$/);
});

test("即時檢查：不能用 Cache API（私密瀏覽）時照已下載的模型的說法", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "caches", { value: undefined, configurable: true });
  });
  await page.goto("./about/");
  const models = page.getByTestId("about-status-models");
  await expect(models).toHaveAttribute("data-state", "unavailable");
  await expect(models).toContainText("這個瀏覽器不能存模型，例如私密瀏覽、無痕視窗與 Tor Browser，每次使用都要重新下載。");
});

test("即時檢查：沒有 service worker 時說明不能離線使用", async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as { serviceWorker?: unknown }).serviceWorker;
  });
  await page.goto("./about/");
  const offline = page.getByTestId("about-status-offline");
  await expect(offline).toHaveAttribute("data-state", "unsupported");
  await expect(offline).toContainText("這個瀏覽器不能離線使用。");
});

test("即時檢查：WebAssembly 被關掉時說明，顯示卡寫用不到", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "WebAssembly", { value: undefined, configurable: true });
  });
  await page.goto("./about/");
  await expect(page.getByTestId("about-status-wasm")).toHaveAttribute("data-state", "no");
  await expect(page.getByTestId("about-status-wasm")).toContainText("鎖定模式");
  await expect(page.getByTestId("about-status-gpu")).toHaveAttribute("data-state", "noWasm");
});

test("即時檢查：可以用顯示卡時（?gpu=force）", async ({ page }) => {
  await page.goto("./about/?gpu=force");
  await expect(page.getByTestId("about-status-gpu")).toHaveAttribute("data-state", "yes");
  await expect(page.getByTestId("about-status-gpu")).toContainText("可以用顯示卡加速。");
});

test("英文版與簡體版沒有露出字串的鍵", async ({ page }) => {
  await page.goto("./en/about/");
  await expect(page.getByRole("heading", { level: 1, name: "Design principles" })).toBeVisible();
  await expect(page.getByTestId("about")).not.toContainText(/about\.[a-z]/);
  await expect(page.getByTestId("about-status-gpu")).not.toHaveAttribute("data-state", "checking");
  await expect(page.getByTestId("about")).not.toContainText(/about\.[a-z]/);
  await page.goto("./en/");
  await page.getByRole("link", { name: "Learn more: Stronger with open-source on-device models" }).click();
  await expect(page).toHaveURL(/\/en\/about\/#models$/);
  await scrolledTo(page, "models");

  await page.goto("./zh-cn/about/");
  await expect(page.getByRole("heading", { level: 1, name: "设计原则" })).toBeVisible();
  await expect(page.getByTestId("about")).not.toContainText(/about\.[a-z]/);
});

// 示意圖（src/ui/AboutFigures.tsx）：三張都在，手機上總覽圖的兩條路線左右並排，疊成一排會看起來像同一條流程
test("設計原則頁的示意圖：三張都在，手機上兩條路線並排", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("./about/");
  for (const id of ["layers", "verify", "confirm"]) await expect(page.getByTestId(`about-fig-${id}`)).toBeVisible();
  const tops = await page.locator(".fig-cross > li").evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().top)));
  expect(tops).toHaveLength(2);
  expect(tops[0]).toBe(tops[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

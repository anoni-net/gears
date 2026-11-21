import { expect, test } from "./guard.ts";

// 協助測試（src/ui/TestingPage.tsx）：桌面的使用者區連得到，每一項測試列出裝置與步驟，
// 按鈕打開要用的頁面，不重新載入（暫存區留著）
test("協助測試：從桌面打開，列出需要的裝置與步驟，按鈕打開裝置量測", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: "協助測試" }).click();
  await expect(page).toHaveURL(/\/testing\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "協助測試" })).toBeVisible();

  const phone = page.getByTestId("testing-phone");
  await expect(phone.getByRole("heading", { name: "手機上的模型量測" })).toBeVisible();
  await expect(phone.locator("ul li")).toHaveCount(5);
  await expect(phone.locator("ol li")).toHaveCount(5);
  await expect(phone.getByRole("link", { name: "討論與整理的結果：anoni-net/gears#144" })).toHaveAttribute("href", "https://github.com/anoni-net/gears/issues/144");
  // 字串的鍵沒有露出來
  await expect(page.getByTestId("testing")).not.toContainText("testing.");

  await phone.getByRole("link", { name: "打開裝置量測" }).click();
  await expect(page).toHaveURL(/\/bench\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "裝置量測" })).toBeVisible();
});

test("協助測試：逐字稿的語音偵測，步驟照畫面上的按鈕名稱，按鈕打開逐字稿", async ({ page }) => {
  await page.goto("./testing/");
  const vad = page.getByTestId("testing-vad");
  await expect(vad.getByRole("heading", { name: "逐字稿的語音偵測" })).toBeVisible();
  await expect(vad.locator("ul li")).toHaveCount(3);
  await expect(vad.locator("ol li")).toHaveCount(5);
  await expect(vad.locator("ol")).toContainText("「開始轉逐字稿」");
  await expect(vad.locator("ol")).toContainText("「再轉一次」");
  await expect(vad.getByRole("link", { name: "討論與整理的結果：anoni-net/gears#196" })).toHaveAttribute("href", "https://github.com/anoni-net/gears/issues/196");
  await vad.getByRole("link", { name: "打開逐字稿" }).click();
  await expect(page).toHaveURL(/\/transcribe\/$/);
});

test("協助測試：逐字稿的標點建議，步驟照畫面上的按鈕名稱，整理結果在 #199", async ({ page }) => {
  await page.goto("./testing/");
  const punct = page.getByTestId("testing-punct");
  await expect(punct.getByRole("heading", { name: "逐字稿的標點建議" })).toBeVisible();
  await expect(punct.locator("ul li")).toHaveCount(3);
  await expect(punct.locator("ol li")).toHaveCount(5);
  await expect(punct.locator("ol")).toContainText("「建議標點」");
  await expect(punct.locator("ol")).toContainText("「仍要使用」");
  await expect(punct.getByRole("link", { name: "討論與整理的結果：anoni-net/gears#199" })).toHaveAttribute("href", "https://github.com/anoni-net/gears/issues/199");
  await punct.getByRole("link", { name: "打開逐字稿" }).click();
  await expect(page).toHaveURL(/\/transcribe\/$/);
});

test("協助測試：問題回報連到建議與回饋", async ({ page }) => {
  await page.goto("./testing/");
  await page.getByRole("link", { name: "建議與回饋" }).first().click();
  await expect(page).toHaveURL(/\/feedback\/$/);
});

test("協助測試：英文版", async ({ page }) => {
  await page.goto("./en/testing/");
  await expect(page.getByRole("heading", { level: 1, name: "Help us test" })).toBeVisible();
  await expect(page.getByTestId("testing")).not.toContainText("testing.");
});

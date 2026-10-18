import { expect, test } from "./guard.ts";

// 範例頁（src/ui/SamplesPage.tsx）：每一份範例檔放進暫存區之後，對應的工具都找得到該找的東西
test.beforeEach(async ({ page }) => {
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: "# from=2025-12 to=2026-09 count=1\nscam-shop.cc\n" }));
});

test("從桌面的使用者區打開範例頁", async ({ page }) => {
  await page.goto("./");
  await page.locator(".desktop").getByRole("button", { name: /^範例/ }).click();
  await expect(page).toHaveURL(/\/gears\/samples\/$/);
  await expect(page).toHaveTitle("範例檔案與條碼 | Gears 檔案工作台");
  await expect(page.getByRole("heading", { name: "範例", exact: true })).toBeVisible();
  await expect(page.getByText("範例的內容都是假的")).toBeVisible();
});

test("換到範例頁時從頁首開始，從工具的連結過來時那個工具的範例排在最前面", async ({ page }) => {
  await page.goto("./");
  const card = page.locator(".desktop").getByRole("button", { name: /^範例/ });
  await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await card.click();
  await expect(page.getByRole("heading", { name: "範例", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".sample-tool").first()).toHaveAttribute("id", "samples-strip-metadata");

  await page.goto("./qr-read/");
  await page.getByTestId("sample-link").click();
  await expect(page.locator(".sample-tool").first()).toHaveAttribute("id", "samples-qr-read");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("帶拍攝位置的照片：清除中繼資料找得到位置與手機型號，清除之後不見了", async ({ page }) => {
  await page.goto("./strip-metadata/");
  await page.getByTestId("sample-link").click();
  await page.locator('[data-sample="photo"]').click();
  await expect(page).toHaveURL(/\/gears\/strip-metadata\/$/);
  await expect(page.getByRole("heading", { name: "IMG_2048.JPG" })).toBeVisible();
  await expect(page.getByTestId("sample-note")).toBeVisible();
  await expect(page.getByText("iPhone 15 Pro").first()).toBeVisible();
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
});

test("打開時會連線的 Word：文件開啟前檢查列出遠端範本與追蹤圖片", async ({ page }) => {
  await page.goto("./samples/");
  await page.locator('[data-sample="docx"]').click();
  await expect(page).toHaveURL(/\/gears\/doc-check\/$/);
  await expect(page.getByText(/tracker\.example\.net/).first()).toBeVisible();
});

test("釣魚信：信件檢查標出寄件驗證沒有通過與回覆地址", async ({ page }) => {
  await page.goto("./samples/");
  await page.locator('[data-sample="eml"]').click();
  await expect(page).toHaveURL(/\/gears\/email-check\/$/);
  await expect(page.getByText(/secure-login\.example\.com/).first()).toBeVisible();
  await expect(page.getByText(/another-domain\.example/).first()).toBeVisible();
});

test("範例信回到桌面之後從暫存區點開，檔案畫面建議信件檢查", async ({ page }) => {
  await page.goto("./samples/");
  await page.locator('[data-sample="eml"]').click();
  await expect(page).toHaveURL(/\/gears\/email-check\/$/);
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.locator(".tray .item .pick").first().click();
  await expect(page.getByRole("heading", { name: "帳戶異常通知.eml" })).toBeVisible();
  await expect(page.locator(".file").getByText("信件檢查", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("這種檔案還沒有辦法檢查裡面的中繼資料")).toHaveCount(0);
});

test("改過金額的報價單：查證找到舊版本", async ({ page }) => {
  await page.goto("./samples/");
  await page.locator('[data-sample="pdf"]').click();
  await expect(page).toHaveURL(/\/gears\/verify\/$/);
  await expect(page.getByText("報價單-2026-118.pdf").first()).toBeVisible();
  await expect(page.getByText("存著較早的版本").first()).toBeVisible();
});

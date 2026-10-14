import { expect, test } from "./guard.ts";

const LIST = "# from=2025-12 to=2026-09 count=2\nscam-shop.cc\nfake-bank.top\n";

test.beforeEach(async ({ page }) => {
  // 固定的測試清單，結果不隨每月的資料變動
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: LIST, contentType: "text/plain" }));
});

test("出現在 165 清單的網址標成危險", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /網址檢查/ }).click();
  await expect(page).toHaveURL(/\/gears\/url-check\/$/);
  await page.getByLabel("要檢查的網址").fill("https://www.scam-shop.cc/pay?utm_source=sms");
  await expect(page.getByRole("alert")).toContainText("出現在 165 公布的停止解析涉詐網站清單（scam-shop.cc，資料到 2026-09）");
  await expect(page.getByTestId("clean-url")).toHaveText("https://www.scam-shop.cc/pay");
});

test("一般的網址：沒有命中、標出真正的網域、清除追蹤碼", async ({ page }) => {
  await page.goto("./url-check/");
  await page.getByLabel("要檢查的網址").fill("shopee.tw.login-verify.top/item?fbclid=abc&id=3");
  await expect(page.getByText("沒有出現在 165 公布的停止解析清單（資料到 2026-09）")).toBeVisible();
  await expect(page.getByText("真正的網域是 login-verify.top")).toBeVisible();
  await expect(page.getByText("「shopee」出現在子網域裡")).toBeVisible();
  await expect(page.getByText("Meta（Facebook、Instagram、Threads）的追蹤碼")).toBeVisible();
  await expect(page.getByTestId("clean-url")).toHaveText("https://shopee.tw.login-verify.top/item?id=3");
});

test("不是網址時說明原因", async ({ page }) => {
  await page.goto("./url-check/");
  await page.getByLabel("要檢查的網址").fill("javascript:alert(1)");
  await expect(page.getByRole("alert")).toHaveText("只檢查 http 與 https 開頭的網址。");
});

test("清單載入失敗時，其他檢查照常", async ({ page, guard }) => {
  await page.unroute("**/gears/data/165.txt");
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("./url-check/");
  await page.getByLabel("要檢查的網址").fill("https://example.com/?utm_campaign=x");
  await expect(page.getByText("清單目前沒有辦法載入")).toBeVisible();
  await expect(page.getByTestId("clean-url")).toHaveText("https://example.com/");
  // 404 會在主控台留下載入失敗的訊息，這裡是預期中的
  guard.errors = guard.errors.filter((e) => !/404|Failed to load resource/i.test(e));
});

import { LEGIT_EML, PHISH_EML } from "../helpers/emails.ts";
import { expect, test } from "./guard.ts";

// 固定的 165 測試清單：釣魚信的寄件網域在清單上
const LIST = "# from=2025-12 to=2026-09 count=1\nsecure-login.example.com\n";

test.beforeEach(async ({ page }) => {
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: LIST, contentType: "text/plain" }));
});

test("從任務貼上冒用的信：驗證沒有通過、需要留意的地方、連結交給網址檢查", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /可疑的通知信/ }).click();
  await page.getByTestId("email-input").fill(PHISH_EML);

  const verdict = page.getByTestId("email-verdict");
  await expect(verdict).toContainText("寄件驗證沒有通過");
  await expect(verdict).toContainText("這封信不像是 secure-login.example.com 寄出的");
  await expect(page.getByText("寄件網域在 165 的停止解析清單上")).toBeVisible();
  await expect(page.getByText("回覆地址跟寄件地址不同")).toBeVisible();
  await expect(page.getByText("按下回覆時，信會寄到 collect@another.example，不是 alert@secure-login.example.com。")).toBeVisible();
  await expect(page.getByText("顯示的名稱裡藏著另一個信箱")).toBeVisible();
  await expect(page.getByText("附件可能會執行程式")).toBeVisible();

  // 只採信最上面那一筆驗證結果，下面自稱通過的不算
  await page.getByText("驗證的細節").click();
  await expect(page.getByText("以下是 mx.example.net 收到信時記下的結果。", { exact: false })).toBeVisible();
  await expect(page.getByText("DMARC：fail，網域 secure-login.example.com，跟寄件網域一致")).toBeVisible();

  const link = page.locator(".email-links li").first();
  await expect(link).toContainText("在 165 清單上");
  await link.getByRole("button", { name: "檢查這個網址" }).click();
  await expect(page.getByRole("heading", { name: "網址檢查" })).toBeVisible();
  await expect(page.locator(".url-check input").first()).toHaveValue("https://secure-login.example.com/verify?id=1&x=2");
});

test("開啟正常的 .eml：驗證通過、主旨、附件加入暫存區", async ({ page }) => {
  await page.goto("./email-check/");
  await page.getByTestId("email-file").setInputFiles({ name: "newsletter.eml", mimeType: "message/rfc822", buffer: Buffer.from(LEGIT_EML) });
  await expect(page.getByText("已開啟 newsletter.eml")).toBeVisible();
  await expect(page.getByTestId("email-verdict")).toContainText("寄件驗證通過");
  await expect(page.getByTestId("email-verdict")).toContainText("收件的伺服器確認這封信來自 news.example.org");
  // 標頭的全文收在「所有標頭」裡，限定在寄件人的區塊
  const sender = page.locator(".email-result section").first();
  await expect(sender.getByText("十月活動通知")).toBeVisible();
  await expect(sender.getByText("社群電子報")).toBeVisible();
  await expect(page.getByRole("heading", { name: "需要留意的地方" })).toHaveCount(0);

  await page.getByText("信件經過的伺服器（2 站）").click();
  await expect(page.getByText("mail.news.example.org（192.0.2.10）→ mx.example.net")).toBeVisible();

  await page.locator(".email-attachments li", { hasText: "報告.pdf" }).getByRole("button", { name: "加入暫存區" }).click();
  await expect(page.getByRole("button", { name: "已加入暫存區" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "從暫存區移除：報告.pdf" })).toBeVisible();
});

test("查證裡的 .eml：寄件驗證、寄件人、時間線，附件可以一起查證", async ({ page }) => {
  await page.goto("./verify/");
  await page.getByTestId("verify-input").setInputFiles([
    { name: "newsletter.eml", mimeType: "message/rfc822", buffer: Buffer.from(LEGIT_EML) },
    { name: "phish.eml", mimeType: "message/rfc822", buffer: Buffer.from(PHISH_EML) },
  ]);
  await expect(page.getByTestId("verify-hash")).toHaveCount(2, { timeout: 15000 });
  const warnings = page.locator(".verify-warnings");
  await expect(warnings.getByText("信件的寄件驗證沒有通過")).toBeVisible();
  await expect(warnings.getByText("phish.eml 按下回覆時會寄到 collect@another.example，不是 alert@secure-login.example.com。")).toBeVisible();

  const card = page.locator(".verify-card").first();
  await expect(card.getByText("信件 · EML")).toBeVisible();
  await expect(card.getByText("十月活動通知")).toBeVisible();
  await expect(card.getByText("寄件驗證通過")).toBeVisible();
  await expect(card.getByText("寄件人 社群電子報 <hello@news.example.org>")).toBeVisible();
  await expect(card.getByText("2026-10-16 17:05:00（UTC+08:00）").first()).toBeVisible();

  await card.getByRole("button", { name: "一起查證" }).click();
  await expect(page.locator(".verify-card").getByRole("heading", { name: "報告.pdf" })).toBeVisible();
  await expect(page.getByTestId("verify-hash")).toHaveCount(3, { timeout: 15000 });
});

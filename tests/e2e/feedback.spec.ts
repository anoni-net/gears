import { test as base, expect, type Page } from "@playwright/test";
import { FEEDBACK_ENDPOINT, FEEDBACK_SURVEYS } from "../../src/feedback.ts";

// 建議與回饋會連到表單伺服器，guard.ts 不允許任何對外連線，所以這裡另外攔下送出的請求，
// 只允許這一個網址，主控台錯誤照樣檢查（CSP 擋下送出時會留下錯誤，請求也不會出現）
const test = base.extend<{ sent: Record<string, unknown>[] }>({
  sent: async ({ page, baseURL }, use) => {
    const sent: Record<string, unknown>[] = [];
    const others: string[] = [];
    const errors: string[] = [];
    const origin = new URL(baseURL!).origin;
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith(origin) && url !== FEEDBACK_ENDPOINT && !url.startsWith("blob:") && !url.startsWith("data:")) others.push(url);
    });
    // 表單沒有開放的測試刻意回 403，瀏覽器會在主控台記一筆載入失敗
    page.on("console", (m) => m.type() === "error" && !/status of 403/.test(m.text()) && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await use(sent);
    expect(others, "對外連線").toEqual([]);
    expect(errors, "主控台錯誤").toEqual([]);
  },
});

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" };

async function answer(page: Page, sent: Record<string, unknown>[], status: number) {
  await page.route(FEEDBACK_ENDPOINT, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: "{}" });
  });
}

test("從桌面的使用者區打開建議與回饋，送出之後顯示收到了，暫存區的檔案留著", async ({ page, sent }) => {
  await answer(page, sent, 200);
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("button", { name: "回到桌面" }).click();

  await expect(page.getByRole("heading", { name: "使用者區" })).toBeVisible();
  await page.locator(".desktop").getByRole("button", { name: /^建議與回饋/ }).click();
  await expect(page).toHaveURL(/\/gears\/feedback\/$/);
  await expect(page.getByRole("heading", { name: "建議與回饋" })).toBeVisible();
  await expect(page.getByTestId("feedback-privacy")).toContainText("暫存區的檔案不會送出");
  // 工具以外的頁面不顯示暫存區
  await expect(page.getByRole("heading", { name: "暫存區" })).toHaveCount(0);

  const send = page.getByRole("button", { name: "送出" });
  await expect(send).toBeDisabled();
  await page.getByLabel("新的工具").check();
  await page.getByTestId("feedback-goal").fill("太短");
  await expect(page.getByText("再多寫一些，至少要 10 個字。")).toBeVisible();
  await expect(send).toBeDisabled();
  await page.getByTestId("feedback-goal").fill("想把手機的錄音轉成逐字稿，但打不開這個檔案");
  await page.getByLabel("每週").check();
  await send.click();

  await expect(page.getByTestId("feedback-sent")).toContainText("收到了，謝謝");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    surveyId: FEEDBACK_SURVEYS["zh-TW"],
    finished: true,
    data: { kind: "新的工具", goal: "想把手機的錄音轉成逐字稿，但打不開這個檔案", frequency: "每週", tool: "home", locale: "zh-TW" },
  });
  expect((sent[0]!.data as Record<string, string>).contact).toBeUndefined();
  await page.getByRole("button", { name: "回到桌面" }).click();
  await expect(page.getByRole("heading", { name: "暫存區" })).toBeVisible();
  await expect(page.getByText("notes.txt").first()).toBeVisible();
});

test("從工具頁的頁尾打開建議與回饋，帶上那個工具。表單沒有開放時說明，填好的內容留著", async ({ page, sent }) => {
  await answer(page, sent, 403);
  await page.goto("./en/qrcode/");
  await page.getByTestId("feedback-link").click();
  await expect(page).toHaveURL(/\/gears\/en\/feedback\/$/);
  await page.getByLabel("Something went wrong").check();
  await page.getByTestId("feedback-goal").fill("The QR code from a long link is too dense to scan");
  await page.getByRole("button", { name: "Submit" }).click();

  await expect(page.getByRole("alert")).toContainText("Suggestions & feedback isn't open right now");
  await expect(page.getByTestId("feedback-goal")).toHaveValue("The QR code from a long link is too dense to scan");
  expect(sent[0]).toMatchObject({ surveyId: FEEDBACK_SURVEYS.en, data: { kind: "Something went wrong", tool: "qrcode", locale: "en" } });
});

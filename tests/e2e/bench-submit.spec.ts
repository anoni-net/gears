import { test as base, expect, type Page } from "@playwright/test";
import { BENCH_SURVEY } from "../../src/bench-submit.ts";
import { FEEDBACK_ENDPOINT } from "../../src/feedback.ts";

// 裝置量測的結果送到表單伺服器，跟建議與回饋同一個網址（tests/e2e/feedback.spec.ts 的做法）。
// guard.ts 不允許任何對外連線，這裡另外攔下送出的請求，只允許這一個網址
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

// 只量 1 個執行緒，CI 的機器只有 4 核心
async function measureOcr(page: Page) {
  await page.goto("./bench/");
  await expect(page.getByTestId("bench-env")).toContainText("核心");
  for (const label of ["CPU，4 個執行緒", "CPU，8 個執行緒"]) {
    const box = page.getByLabel(label);
    if (await box.isChecked()) await box.uncheck();
  }
  const gpu = page.getByLabel("顯示卡", { exact: true }).first();
  if ((await gpu.isEnabled()) && (await gpu.isChecked())) await gpu.uncheck();
  await page.getByRole("button", { name: "量測文字辨識" }).click();
  await expect(page.getByTestId("bench-ocr-status")).toHaveText("文字辨識量測完成。", { timeout: 90_000 });
}

test("裝置量測：選了裝置才能送出，送出的是畫面上的 JSON 與填的欄位，同一份不再送第二次", async ({ page, sent }) => {
  test.setTimeout(120_000);
  await answer(page, sent, 200);
  await page.goto("./bench/");
  await expect(page.getByRole("button", { name: "送出結果" })).toBeDisabled();
  await measureOcr(page);
  await expect(page.getByTestId("bench-send-privacy")).toContainText("保留 52 天");
  await expect(page.getByRole("button", { name: "送出結果" })).toBeDisabled();

  await page.getByLabel("筆電").check();
  await page.getByLabel("大約哪一年買的（選填）").fill("2021");
  await page.getByLabel("24 GB").check();
  await page.getByRole("button", { name: "送出結果" }).click();
  await expect(page.getByTestId("bench-sent")).toContainText("收到了");
  await expect(page.getByRole("button", { name: "送出結果" })).toBeDisabled();

  expect(sent).toHaveLength(1);
  const body = sent[0] as { surveyId: string; finished: boolean; data: Record<string, string> };
  expect(body.surveyId).toBe(BENCH_SURVEY);
  expect(body.finished).toBe(true);
  // 選擇題一律送正體中文的選項，跟 formbricks/gears_bench_survey.py 相同
  expect(body.data).toMatchObject({ device: "筆電", year: "2021", memory: "24 GB", locale: "zh-TW" });
  expect(body.data).not.toHaveProperty("note");
  await page.getByText("看複製的內容", { exact: true }).click();
  expect(body.data.report).toBe(await page.getByTestId("bench-report").textContent());
  expect(JSON.parse(body.data.report!).ocr).toHaveLength(1);
});

test("裝置量測：英文介面送出的選項仍是正體中文，表單沒有開放時說明可以先複製", async ({ page, sent }) => {
  test.setTimeout(120_000);
  await answer(page, sent, 403);
  await page.goto("./en/bench/");
  await expect(page.getByTestId("bench-env")).toContainText("cores");
  for (const label of ["CPU, 4 threads", "CPU, 8 threads"]) {
    const box = page.getByLabel(label);
    if (await box.isChecked()) await box.uncheck();
  }
  const gpu = page.getByLabel("GPU", { exact: true }).first();
  if ((await gpu.isEnabled()) && (await gpu.isChecked())) await gpu.uncheck();
  await page.getByRole("button", { name: "Measure text recognition" }).click();
  await expect(page.getByTestId("bench-ocr-status")).toHaveText("Text recognition benchmark finished.", { timeout: 90_000 });
  await page.getByLabel("Phone").check();
  await page.getByRole("button", { name: "Send results" }).click();
  await expect(page.getByRole("alert")).toContainText("not open right now");
  expect((sent[0] as { data: Record<string, string> }).data).toMatchObject({ device: "手機", locale: "en" });
  // 沒有送成功，可以再按一次
  await expect(page.getByRole("button", { name: "Send results" })).toBeEnabled();
});

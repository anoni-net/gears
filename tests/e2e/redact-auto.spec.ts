import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 白底黑字的截圖：一行電話、一行 Email、一行一般的文字。英文與數字，CI 沒有中文字型
async function screenshot(page: Page, withText: boolean) {
  const data = await page.evaluate(async (text) => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 360;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    if (text) {
      g.fillStyle = "#000";
      g.font = "48px sans-serif";
      g.fillText("Call 0912-345-678", 40, 90);
      g.fillText("jane.doe@example.org", 40, 190);
      g.fillText("See you tomorrow", 40, 290);
    }
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, withText);
  return Buffer.from(data);
}

async function openRedact(page: Page, data: Buffer) {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: data });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
}

test("找電話、Email：辨識出兩筆個資，框起來，再把所有文字框起來", async ({ page }) => {
  test.setTimeout(120_000);
  await openRedact(page, await screenshot(page, true));
  await page.getByRole("button", { name: "找電話、Email 等個資" }).click();
  const status = page.getByTestId("redact-auto-status");
  await expect(status).toHaveText("加了 2 個框，請逐一確認，框錯的點一下就會拿掉。", { timeout: 90_000 });
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();
  await page.getByRole("button", { name: /框起所有文字/ }).click();
  await expect(page.getByText("已經框了 3 個範圍")).toBeVisible();
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible();
});

test("找人臉：模型在 CSP 底下載入，沒有人臉時說明沒有找到", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await openRedact(page, await screenshot(page, false));
  await page.getByRole("button", { name: "找人臉" }).click();
  // 無頭模式的 Firefox 沒有 WebGL，說明原因；其他瀏覽器實際跑完偵測
  const expected = browserName === "firefox" ? "這個瀏覽器關閉了 WebGL，沒有辦法自動找人臉，請手動框選。找個資不受影響。" : "沒有找到。自動尋找會漏掉，請自己再看一次整張圖。";
  await expect(page.getByTestId("redact-auto-status")).toHaveText(expected, { timeout: 90_000 });
});

test("找人臉：載入模型與尋找時顯示進度，完成後拿掉", async ({ page, browserName }) => {
  test.skip(browserName === "firefox", "無頭模式的 Firefox 沒有 WebGL");
  test.setTimeout(120_000);
  // 模型晚一點才回來，載入的階段才看得到
  await page.route("**/models/blaze_face_short_range.tflite", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await openRedact(page, await screenshot(page, false));
  await page.getByRole("button", { name: "找人臉" }).click();
  const bar = page.getByRole("progressbar", { name: "找人臉" });
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await expect(page.getByTestId("redact-auto-status")).toHaveText("載入辨識模型中…第一次使用要下載約 13 MB。");
  await expect(page.getByRole("button", { name: "找人臉" })).toBeDisabled();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("沒有找到。自動尋找會漏掉，請自己再看一次整張圖。", { timeout: 90_000 });
  await expect(bar).toBeHidden();
});

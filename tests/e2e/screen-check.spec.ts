import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 檔案畫面的「檢查畫面內容」（src/ui/ScreenCheck.tsx）：找人臉與辨識文字跟遮蔽的自動尋找同一套，
// 找到的框交給遮蔽放好

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

async function addScreenshot(page: Page, withText: boolean) {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "chat.png", mimeType: "image/png", buffer: await screenshot(page, withText) });
  await expect(page.getByTestId("screen-check")).toBeVisible();
}

test("找到電話與 Email，打開遮蔽時框已經放好，套用之後成為新的版本", async ({ page }) => {
  test.setTimeout(120_000);
  await addScreenshot(page, true);
  await expect(page.getByTestId("screen-download")).toHaveText("第一次檢查要下載約 40 MB 的辨識模型，之後存在這台裝置的瀏覽器裡。");
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  const status = page.getByTestId("screen-status");
  // 類別看辨識出的文字，Email 偶爾被讀成帳號，只確認電話與兩筆的數量
  await expect(status).toHaveText(/^找到：電話號碼 1 處、.+ 1 處。自動尋找會漏掉，交出去之前請自己再看一次整張圖。$/, { timeout: 90_000 });
  // 只列數量，不在檔案畫面列出找到的文字
  await expect(page.getByTestId("screen-check")).not.toContainText("0912");

  await page.getByRole("button", { name: "打開遮蔽，框已經放好" }).click();
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("已經放好檢查畫面內容時找到的 2 個框，請逐一確認，框錯的點一下就會拿掉。");
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByTestId("history-current").getByText("遮蔽", { exact: true })).toBeVisible();
});

test("沒有找到時用灰色說明會漏，不出現打開遮蔽的按鈕", async ({ page }) => {
  test.setTimeout(120_000);
  await addScreenshot(page, false);
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  const status = page.getByTestId("screen-status");
  await expect(status).toHaveText("沒有找到人臉與電話、Email 這類個資。自動尋找會漏掉，交出去之前請自己再看一次整張圖。", { timeout: 90_000 });
  await expect(status).toHaveClass("hint");
  await expect(page.getByRole("button", { name: "打開遮蔽，框已經放好" })).toHaveCount(0);
});

test("檢查找到的框不會帶進之後從工具列打開的遮蔽", async ({ page }) => {
  test.setTimeout(120_000);
  await addScreenshot(page, true);
  await page.getByRole("button", { name: "檢查畫面內容" }).click();
  await expect(page.getByTestId("screen-status")).toContainText("找到：", { timeout: 90_000 });
  await page.getByRole("button", { name: "打開遮蔽，框已經放好" }).click();
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  // 工具列的遮蔽：一般的打開方式，沒有預先放好的框
  await page.getByRole("button", { name: "打開遮蔽" }).click();
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByTestId("redact-auto-status")).toHaveText("側臉、戴口罩的臉、小字與手寫字常會漏掉，套用之前請自己再檢查一次。");
});

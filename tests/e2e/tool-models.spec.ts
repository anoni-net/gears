import { MODEL_CATALOG, TOOL_MODELS } from "../../src/core/model-catalog.ts";
import { expect, test } from "./guard.ts";

// 標了開源本機模型的工具，工具頁最下面列出用到的模型，連到已下載的模型（開新分頁，貼上的文字留著）
test("用到模型的工具頁列出模型，連到已下載的模型", async ({ page, context }) => {
  await page.goto("./writing-style/");
  const section = page.getByTestId("tool-models");
  await expect(section.getByRole("heading", { name: "用到的開源模型" })).toBeVisible();
  await expect(section.locator("li")).toHaveCount(1);
  await expect(section.locator("li")).toContainText("nym-pii");
  await expect(section.locator("li")).toContainText("找人名、地址與單位");

  await page.getByRole("textbox").first().fill("請聯絡王小明");
  const [tab] = await Promise.all([context.waitForEvent("page"), section.getByRole("link", { name: "管理已下載的模型" }).click()]);
  await expect(tab).toHaveURL(/\/storage\/$/);
  await tab.close();
  await expect(page.getByRole("textbox").first()).toHaveValue("請聯絡王小明");
});

// 每一頁各開一次：從空白開始的工具在背景載入元件，載入中換頁時 WebKit 會在主控台留下錯誤
test("處理檔案的工具在還沒選檔案的畫面列出", async ({ page }) => {
  await page.goto("./transcribe/");
  await expect(page.getByTestId("tool-models").locator("li")).toHaveCount(TOOL_MODELS.transcribe!.length);
});

test("查證列出比對相近圖片的模型", async ({ page }) => {
  const dino = MODEL_CATALOG.find((m) => m.id === "dino")!;
  await page.goto("./verify/");
  await expect(page.getByTestId("tool-models").locator("li")).toHaveText([new RegExp(dino.name)]);

});

test("沒有用到模型的工具不顯示", async ({ page }) => {
  await page.goto("./qrcode/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("tool-models")).toHaveCount(0);
});

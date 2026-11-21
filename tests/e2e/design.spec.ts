import type { Page } from "@playwright/test";
import { toolIds } from "../../src/tools/index.ts";
import { expect, test } from "./guard.ts";

// AGENTS.md「設計語言」裡要在畫面上檢查的規則

// 每個區域可以按的實心按鈕不超過一顆。區域是最近的 section、清單的一列、檔名那一列或一組選項，
// 回傳有兩顆以上的區域與按鈕的文字
async function crowded(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const regions = new Map<Element, string[]>();
    for (const button of document.querySelectorAll<HTMLElement>("main button.primary, main a.button.primary")) {
      if ((button as HTMLButtonElement).disabled || !button.offsetParent) continue;
      const region = button.closest("section, li, .file-head, fieldset") ?? document.body;
      regions.set(region, [...(regions.get(region) ?? []), button.textContent!.trim()]);
    }
    return [...regions.values()].filter((names) => names.length > 1);
  });
}

test("桌面與每個工具頁：每個區域最多一顆實心按鈕", async ({ page }) => {
  for (const id of ["", ...toolIds]) {
    await page.goto(id ? `./${id}/` : "./");
    await expect(page.locator("main")).toBeVisible();
    // 從空白開始的工具用到時才載入，等工具名稱出現、程式載完
    if (id) await expect(page.locator("h1.tool-title")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await crowded(page), id || "home").toEqual([]);
  }
});

test("檔案畫面：處理前後每個區域最多一顆實心按鈕", async ({ page }) => {
  await page.goto("./samples/");
  await page.locator("[data-sample=photo]").click();
  await expect(page.locator("h1#file-title")).toBeVisible();
  expect(await crowded(page), "處理前").toEqual([]);
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.locator(".file-head").getByRole("link", { name: "下載" })).toBeVisible();
  expect(await crowded(page), "處理後").toEqual([]);
});

// 手機上打開編輯畫面時，要操作的圖片出現在第一個畫面裡。原本遮蔽的圖片在第 1.1 個畫面（2026-11-21 量）
test("手機上編輯畫面的操作區在第一個畫面內", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [tool, surface] of [
    ["遮蔽", "[data-testid=redact-canvas], .redact canvas"],
    ["列印追蹤點", "[data-testid=print-dots-canvas]"],
  ] as const) {
    await page.goto("./samples/");
    await page.locator("[data-sample=photo]").click();
    await page.getByRole("button", { name: `打開${tool}` }).click();
    const canvas = page.locator(surface).first();
    await expect(canvas).toBeVisible();
    const top = await canvas.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(top, tool).toBeLessThan(844);
  }
});

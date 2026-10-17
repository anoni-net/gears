import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 手機的長截圖：寬 1080、高 3000
async function tallScreenshot(page: Page) {
  const data = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 3000;
    const g = c.getContext("2d")!;
    g.fillStyle = "#eee";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#36c";
    for (let y = 0; y < c.height; y += 200) g.fillRect(40, y + 40, 700, 100);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  return Buffer.from(data);
}

test("長截圖的畫布最高只佔畫面的 70%，下方的按鈕捲得到", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "long.png", mimeType: "image/png", buffer: await tallScreenshot(page) });
  const canvas = page.getByTestId("redact-canvas");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.height).toBeLessThanOrEqual(viewport.height * 0.7 + 1);
  await page.getByRole("button", { name: "取消" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "取消" })).toBeInViewport();
});

// 多點觸控只有 Chromium 能從測試送出（CDP 的 Input.dispatchTouchEvent）
test("畫布上兩根手指捲動頁面，不會留下框", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "多點觸控只在 Chromium 測");
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true, baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "long.png", mimeType: "image/png", buffer: await tallScreenshot(page) });
  const canvas = page.getByTestId("redact-canvas");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const before = await page.evaluate(() => window.scrollY);
  const cdp = await context.newCDPSession(page);
  const x = box.x + box.width / 2;
  const touch = (y: number) => [
    { x: x - 40, y, id: 1 },
    { x: x + 40, y, id: 2 },
  ];
  const top = box.y + box.height * 0.8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(top) });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(top - i * 20) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
  await expect(page.getByText("已經框了 0 個範圍")).toBeVisible();
  await context.close();
});

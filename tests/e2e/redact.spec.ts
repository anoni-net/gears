import type { Page } from "@playwright/test";
import { expect, test } from "./guard.ts";

// 紅底、左上角一塊綠色的圖，遮住綠色那塊之後檢查像素
async function image(page: Page, mime: "image/png" | "image/jpeg") {
  const data = await page.evaluate(async (type) => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d22";
    g.fillRect(0, 0, 400, 200);
    g.fillStyle = "#2a2";
    g.fillRect(40, 40, 120, 60);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), type, 0.95));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, mime);
  return Buffer.from(data);
}

// 在畫布上依圖片的相對位置拖一個框
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId("redact-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2));
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1]);
  await page.mouse.up();
}

// 讀預覽圖上某一點的顏色（相對位置）
async function pixel(page: Page, x: number, y: number) {
  return page.locator(".preview img").evaluate(
    async (img: HTMLImageElement, [px, py]) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(px * c.width), Math.floor(py * c.height), 1, 1).data.slice(0, 3));
    },
    [x, y] as [number, number],
  );
}

test("從任務選檔案，直接打開遮蔽畫面，塗黑之後產生新版本", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /遮蔽截圖上的名字與電話/ }).click()]);
  await chooser.setFiles({ name: "chat.png", mimeType: "image/png", buffer: await image(page, "image/png") });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();

  // 綠色那塊在 (40,40)-(160,100)，相對位置約 (0.1,0.2)-(0.4,0.5)，框大一點
  await drag(page, [0.08, 0.15], [0.42, 0.55]);
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();
  await page.getByRole("button", { name: "套用遮蔽" }).click();

  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible();
  await expect(page.getByText("塗成實心黑色的範圍")).toBeVisible();
  await expect(page.getByText("1 個範圍")).toBeVisible();
  const inside = await pixel(page, 0.25, 0.35);
  const outside = await pixel(page, 0.8, 0.8);
  expect(Math.max(...inside)).toBeLessThanOrEqual(24);
  expect(outside[0]).toBeGreaterThan(180);
});

test("從工具列打開，點一下框好的範圍可以刪掉，取消不產生新版本", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: await image(page, "image/jpeg") });
  await page.getByRole("button", { name: "遮蔽" }).click();
  await drag(page, [0.1, 0.1], [0.3, 0.3]);
  await drag(page, [0.6, 0.6], [0.9, 0.9]);
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();

  // 觸控螢幕用點擊的方式跟真實操作一致，桌機用滑鼠
  const box = (await page.getByTestId("redact-canvas").boundingBox())!;
  const [x, y] = [box.x + box.width * 0.2, box.y + box.height * 0.2];
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();
  await page.getByRole("button", { name: "復原上一個框" }).click();
  await expect(page.getByText("已經框了 0 個範圍")).toBeVisible();
  await expect(page.getByRole("button", { name: "套用遮蔽" })).toBeDisabled();

  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("redact-canvas")).toHaveCount(0);
  await expect(page.getByText("遮蔽後", { exact: true })).toHaveCount(0);
});

test("JPEG 遮蔽後重新編碼，原本的中繼資料一起拿掉", async ({ page }) => {
  await page.goto("./redact/");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選擇檔案" }).first().click()]);
  await chooser.setFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: await image(page, "image/jpeg") });
  await drag(page, [0.1, 0.2], [0.4, 0.5]);
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("重新編碼，原檔的中繼資料一併拿掉")).toBeVisible();
  expect(Math.max(...(await pixel(page, 0.25, 0.35)))).toBeLessThanOrEqual(24);
});

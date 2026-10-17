import type { Page } from "@playwright/test";
import { encodeQr, qrPng } from "../../src/tools/qrcode/index.ts";
import { expect, test } from "./guard.ts";

// Tor Browser 在讀者允許之前，讀取 canvas 的像素一律得到亂數（src/ui/canvas-access.ts）。
// 這裡把 getImageData 換成回傳亂數，window.allowCanvas() 模擬讀者在網址列按了允許
async function blockCanvas(page: Page) {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.getImageData;
    let allowed = false;
    (window as unknown as { allowCanvas(): void }).allowCanvas = () => {
      allowed = true;
    };
    CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof original>) {
      const real = original.apply(this, args);
      if (allowed) return real;
      crypto.getRandomValues(real.data.subarray(0, Math.min(real.data.length, 65536)));
      for (let i = 65536; i < real.data.length; i++) real.data[i] = (i * 7919) & 255;
      return real;
    };
  });
}

const allow = (page: Page) => page.evaluate(() => (window as unknown as { allowCanvas(): void }).allowCanvas());

// 紅底、左上角一塊綠色的圖
async function image(page: Page, type = "image/png") {
  const data = await page.evaluate(async (type) => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d22";
    g.fillRect(0, 0, 400, 200);
    g.fillStyle = "#2a2";
    g.fillRect(40, 40, 120, 60);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), type));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, type);
  return Buffer.from(data);
}

test.beforeEach(async ({ page }) => {
  await blockCanvas(page);
});

test("讀不到 canvas 時說明要在網址列允許，允許之後再讀一次就讀得到", async ({ page }) => {
  await page.goto("./qr-read/");
  const png = Buffer.from(qrPng(encodeQr("4493932457", "M"), 6));
  await page.getByTestId("qr-input").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("alert")).toContainText("網址列跳出詢問");
  await expect(page.getByTestId("qr-text")).toHaveCount(0);

  await allow(page);
  await page.getByTestId("qr-input").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("qr-text")).toHaveText("4493932457");
});

test("遮蔽：讀不到 canvas 時不產生雜訊圖，框留著，允許之後再套用", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /截圖上的名字與電話/ }).click()]);
  await chooser.setFiles({ name: "chat.png", mimeType: "image/png", buffer: await image(page) });
  const canvas = page.getByTestId("redact-canvas");
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35);
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55);
  await page.mouse.up();
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();

  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByRole("alert")).toContainText("網址列跳出詢問");
  await expect(page.getByText("遮蔽後", { exact: true })).toHaveCount(0);
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();

  await allow(page);
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("遮蔽後", { exact: true })).toBeVisible();
});

test("列印追蹤點：讀不到 canvas 時不判斷、不輸出，允許之後再套用", async ({ page }) => {
  await page.goto("./print-dots/");
  await page.getByTestId("file-input").setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: await image(page) });
  await expect(page.getByRole("alert")).toContainText("網址列跳出詢問");
  await expect(page.getByTestId("print-dots-status")).toBeEmpty();
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByRole("alert")).toContainText("網址列跳出詢問");
  await expect(page.getByText("去掉追蹤點後", { exact: true })).toHaveCount(0);

  await allow(page);
  await page.getByRole("button", { name: "只看黃色" }).click();
  await expect(page.getByTestId("print-dots-status")).toContainText("沒有找到");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "套用" }).click();
  await expect(page.getByText("去掉追蹤點後", { exact: true })).toBeVisible();
});

test("縮成常見尺寸：讀不到 canvas 時不輸出，允許之後再按一次", async ({ page }) => {
  await page.goto("./blend/");
  await page.getByTestId("file-input").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: await image(page, "image/jpeg") });
  await page.getByRole("button", { name: "縮小並重新壓縮" }).click();
  await expect(page.getByRole("alert")).toContainText("網址列跳出詢問");
  await expect(page.getByText("縮成常見尺寸後", { exact: true })).toHaveCount(0);

  await allow(page);
  await page.getByRole("button", { name: "縮小並重新壓縮" }).click();
  await expect(page.getByText("縮成常見尺寸後", { exact: true })).toBeVisible();
});

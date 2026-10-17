import type { Page } from "@playwright/test";
import { downloadFrom, expect, test } from "./guard.ts";
import { extractExif } from "../../src/tools/redact/keep-exif.ts";
import { parseExif } from "../../src/tools/strip-metadata/exif.ts";
import { exifSegment, insertIntoJpeg, sampleTiff } from "../helpers/fixtures.ts";

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

// 畫布先捲進畫面再讀位置，畫面外的座標不會觸發事件（CI 沒有中文字型，版面比本機高）
async function canvasBox(page: Page) {
  const canvas = page.getByTestId("redact-canvas");
  // 圖片解碼完之前畫布不接受輸入
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await canvas.scrollIntoViewIfNeeded();
  return (await canvas.boundingBox())!;
}

// 在畫布上依圖片的相對位置拖一個框
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = await canvasBox(page);
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
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /截圖上的名字與電話/ }).click()]);
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
  await page.getByRole("button", { name: "開始框選" }).click();
  await drag(page, [0.1, 0.1], [0.3, 0.3]);
  await drag(page, [0.6, 0.6], [0.9, 0.9]);
  await expect(page.getByText("已經框了 2 個範圍")).toBeVisible();

  // 觸控螢幕用點擊的方式跟真實操作一致，桌機用滑鼠
  const box = await canvasBox(page);
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

test("遮蔽時保留拍攝資訊：時間、地點與型號留著，縮圖拿掉，旋轉方向是正向", async ({ page }) => {
  await page.goto("./redact/");
  const photo = insertIntoJpeg(new Uint8Array(await image(page, "image/jpeg")), exifSegment(sampleTiff(1)));
  await page.getByTestId("file-input").setInputFiles({ name: "evidence.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo) });
  const keep = page.getByRole("checkbox", { name: /保留拍攝的時間、地點與相機型號/ });
  await expect(keep).not.toBeChecked();
  await keep.check();
  await drag(page, [0.1, 0.2], [0.4, 0.5]);
  await page.getByRole("button", { name: "套用遮蔽" }).click();
  await expect(page.getByText("拍攝的時間、地點與相機型號（縮圖與相機廠商的私有資料拿掉，旋轉方向重設）")).toBeVisible();
  await expect(page.getByTestId("removed-note")).toContainText("依你的選擇保留了拍攝的時間、地點與相機型號");
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const info = parseExif(extractExif(file.data, "jpeg")!);
  expect(info).toMatchObject({ model: "SECRET-MODEL", gps: true, thumbnail: false, orientation: 1, dateTime: "2026:10:14 09:30:00" });
});

test("沒有拍攝資訊的圖片不顯示保留的選項", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "plain.png", mimeType: "image/png", buffer: await image(page, "image/png") });
  await expect(page.getByTestId("redact-canvas")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});

test("圖片解碼完之前畫布標成忙碌，準備好之後才接受輸入", async ({ page }) => {
  // 模擬很忙的機器：解碼延遲 2 秒。之前 CI 偶發失敗就是測試在這段時間裡操作，第一個輸入被忽略
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) =>
      new Promise((resolve) => setTimeout(resolve, 2000)).then(() => original(...args))) as typeof createImageBitmap;
  });
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "plain.png", mimeType: "image/png", buffer: await image(page, "image/png") });
  const canvas = page.getByRole("application", { name: "要遮蔽的圖片" });
  await expect(canvas).toHaveAttribute("aria-busy", "true");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await canvas.focus();
  for (const key of ["Enter", "Shift+ArrowLeft", "Shift+ArrowUp", "Enter", "Shift+ArrowRight", "Shift+ArrowRight", "Shift+ArrowDown", "Enter"]) await page.keyboard.press(key);
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();
});

test("用鍵盤框選：方向鍵移動、Enter 標兩個角，Delete 刪掉", async ({ page }) => {
  await page.goto("./redact/");
  await page.getByTestId("file-input").setInputFiles({ name: "plain.png", mimeType: "image/png", buffer: await image(page, "image/png") });
  const canvas = page.getByRole("application", { name: "要遮蔽的圖片" });
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await canvas.focus();
  await page.keyboard.press("Enter"); // 出現游標
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Enter"); // 第一個角
  await expect(page.getByText("標好第一個角了，移到對角再按 Enter。")).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("已經框了 1 個範圍")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByText("已經框了 0 個範圍")).toBeVisible();
});

test("圖片很高時，套用與取消固定在畫面底部，打開就看得到", async ({ page }) => {
  await page.goto("./redact/");
  const data = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 1800;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d22";
    g.fillRect(0, 0, c.width, c.height);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId("file-input").setInputFiles({ name: "tall.png", mimeType: "image/png", buffer: Buffer.from(data) });
  await page.getByTestId("redact-canvas").scrollIntoViewIfNeeded();
  const viewport = page.viewportSize()!;
  for (const name of ["取消", "套用遮蔽"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
});

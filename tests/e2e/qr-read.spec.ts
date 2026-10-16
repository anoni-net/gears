import { encodeQr, MARGIN, qrPng } from "../../src/tools/qrcode/index.ts";
import { expect, test } from "./guard.ts";

const png = (text: string) => Buffer.from(qrPng(encodeQr(text, "M"), 6));

test.beforeEach(async ({ page }) => {
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: "# from=2025-12 to=2026-09 count=1\nscam-shop.cc\n" }));
});

test("從照片讀出網址，再交給網址檢查", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /QR code 讀取/ }).click();
  await expect(page).toHaveURL(/\/gears\/qr-read\/$/);
  await page.getByTestId("qr-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png("https://scam-shop.cc/login?utm_source=sms") });
  await expect(page.getByTestId("qr-text")).toHaveText("https://scam-shop.cc/login?utm_source=sms");

  await page.getByRole("button", { name: "用網址檢查" }).click();
  await expect(page).toHaveURL(/\/gears\/url-check\/$/);
  await expect(page.getByLabel("要檢查的網址")).toHaveValue("https://scam-shop.cc/login?utm_source=sms");
  await expect(page.getByRole("alert")).toContainText("出現在 165 公布的停止解析涉詐網站清單");
});

test("Wi-Fi 的 QR code 拆成網路名稱與密碼", async ({ page }) => {
  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "wifi.png", mimeType: "image/png", buffer: png("WIFI:T:WPA;S:anoni-cafe;P:secret pass;;") });
  await expect(page.locator(".wifi dd").first()).toHaveText("anoni-cafe");
  await expect(page.getByText("secret pass", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "複製密碼" })).toBeVisible();
});

test("翻拍螢幕的照片，白底上有子像素的直紋也讀得出來", async ({ page }) => {
  await page.goto("./qr-read/");
  // 模擬翻拍螢幕：每三個像素一條灰色直紋，原尺寸 jsQR 讀不出來，縮小之後才讀得到
  const m = encodeQr("4493932457", "M");
  const photo = await page.evaluate(async ({ size, dark, margin }) => {
    const mod = 30;
    const side = (size + 2 * margin) * mod;
    const c = document.createElement("canvas");
    c.width = side;
    c.height = side;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(side, side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const mx = Math.floor(x / mod) - margin;
        const my = Math.floor(y / mod) - margin;
        const isDark = mx >= 0 && my >= 0 && mx < size && my < size && dark[my * size + mx];
        const v = isDark ? 20 : x % 3 === 0 ? 170 : 235;
        img.data.set([v, v, v, 255], (y * side + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, { ...m, margin: MARGIN });
  await page.getByTestId("qr-input").setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: Buffer.from(photo) });
  await expect(page.getByTestId("qr-text")).toHaveText("4493932457");
});

test("找不到 QR code 時說明", async ({ page }) => {
  await page.goto("./qr-read/");
  const blank = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 50;
    c.height = 50;
    const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByTestId("qr-input").setInputFiles({ name: "blank.png", mimeType: "image/png", buffer: Buffer.from(blank) });
  await expect(page.getByRole("alert")).toContainText("照片裡找不到 QR code");
});

test("暫存區裡的圖片含有 QR code，檔案畫面自動讀出來", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: png("訂位代號 ABC123 王小明") });
  await expect(page.getByRole("heading", { name: "圖片裡的 QR code" })).toBeVisible();
  await expect(page.getByTestId("qr-text")).toHaveText("訂位代號 ABC123 王小明");
});

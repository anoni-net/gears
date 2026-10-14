import { encodeQr, qrPng } from "../../src/tools/qrcode/index.ts";
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

import { wifiPayload } from "../../src/tools/qrcode/index.ts";
import { decodeQrPng } from "../helpers/qr-decode.ts";
import { downloadFrom, expect, test } from "./guard.ts";

test("從桌面打開 QR code 產生器，中文內容下載成 PNG 與 SVG", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /QR code 產生器/ }).click();
  await expect(page).toHaveURL(/\/gears\/qrcode\/$/);
  await expect(page).toHaveTitle("QR code 產生器 | Gears 檔案工作台");
  await expect(page.getByText("輸入內容之後，QR code 會出現在這裡。")).toBeVisible();

  const text = "匿名網路社群 https://anoni.net/";
  await page.getByLabel("要放進 QR code 的內容").fill(text);
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toBeVisible();

  const png = await downloadFrom(page, () => page.getByRole("button", { name: "下載 PNG" }).click());
  expect(png.name).toBe("qrcode.png");
  expect(decodeQrPng(png.data)).toBe(text);

  const svg = await downloadFrom(page, () => page.getByRole("button", { name: "下載 SVG" }).click());
  expect(svg.name).toBe("qrcode.svg");
  expect(Buffer.from(svg.data).toString("utf8")).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test("Wi-Fi 任務：產生的檔案放進暫存區，接著可以下載", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /給朋友的 Wi-Fi 密碼/ }).click();
  await expect(page).toHaveURL(/\/gears\/qrcode\/$/);
  await expect(page.getByLabel("Wi-Fi")).toBeChecked();

  await page.getByLabel("網路名稱（SSID）").fill("Cafe;5G");
  await page.getByLabel("密碼", { exact: true }).fill("p@ss:word");
  await page.getByRole("button", { name: "放進暫存區" }).click();

  // 回到桌面，檔案出現在暫存區並被選取
  await expect(page).toHaveURL(/\/gears\/$/);
  await expect(page.locator(".tray .item")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "wifi-qrcode.png" })).toBeVisible();
  await expect(page.getByText("QR code 產生器建立")).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(decodeQrPng(file.data)).toBe(wifiPayload({ ssid: "Cafe;5G", password: "p@ss:word", security: "WPA", hidden: false }));
});

test("內容太長時說明原因，不顯示 QR code", async ({ page }) => {
  await page.goto("./qrcode/");
  await page.getByLabel("要放進 QR code 的內容").fill("x".repeat(3500));
  await expect(page.getByRole("alert")).toContainText("內容太長");
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toHaveCount(0);
});

test("每個工具都有自己的網址，可以直接打開，也可以用上一頁回去", async ({ page }) => {
  await page.goto("./strip-metadata/");
  await expect(page).toHaveTitle("清除照片、文件與影音的中繼資料 | Gears 檔案工作台");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /拍攝位置/);
  await expect(page.getByRole("heading", { name: "清除中繼資料" })).toBeVisible();
  await expect(page.getByText("也可以從暫存區選一個已經加入的檔案。")).toBeVisible();

  await page.getByRole("button", { name: "回到桌面" }).click();
  await expect(page).toHaveURL(/\/gears\/$/);
  await expect(page).toHaveTitle("anoni.net Gears 檔案工作台");

  await page.getByRole("button", { name: /QR code 產生器/ }).click();
  await expect(page).toHaveURL(/\/gears\/qrcode\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/gears\/$/);
  await expect(page.getByRole("heading", { name: "常見的情況" })).toBeVisible();
});

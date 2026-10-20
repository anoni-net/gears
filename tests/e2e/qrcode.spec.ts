import { eventPayload, vcardPayload, wifiPayload } from "../../src/tools/qrcode/index.ts";
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

test("Wi-Fi 的 QR code：產生的檔案放進暫存區，接著可以下載", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /^QR code 產生器/ }).click();
  await expect(page).toHaveURL(/\/gears\/qrcode\/$/);
  await page.getByLabel("Wi-Fi").check();

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

test("聯絡資料：填的欄位變成 vCard，下載的 PNG 解碼回來一字不差", async ({ page }) => {
  await page.goto("./qrcode/");
  await page.getByRole("radio", { name: "聯絡資料" }).check();
  await page.getByLabel("姓名").fill("陳小明");
  await page.getByLabel("電話號碼").fill("0912-345-678");
  await page.getByLabel("單位").fill("anoni.net");
  await expect(page.getByText("只填願意公開的欄位")).toBeVisible();

  const png = await downloadFrom(page, () => page.getByRole("button", { name: "下載 PNG" }).click());
  expect(png.name).toBe("contact-qrcode.png");
  const expected = vcardPayload({ name: "陳小明", phone: "0912-345-678", email: "", org: "anoni.net", url: "" });
  expect(decodeQrPng(png.data)).toBe((expected as { text: string }).text);

  // QR code 裡實際的文字收在預覽下方
  await page.getByText("QR code 裡的文字").click();
  await expect(page.getByTestId("qr-raw")).toContainText("TEL:0912345678");

  // 格式不對時說明，不畫出 QR code
  await page.getByRole("textbox", { name: "Email" }).fill("ming@");
  await expect(page.getByRole("alert")).toContainText("Email 的格式不對");
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toHaveCount(0);
});

test("活動：選好時間就畫出來，結束早於開始時說明", async ({ page }) => {
  await page.goto("./qrcode/");
  await page.getByRole("radio", { name: "活動" }).check();
  await page.getByLabel("活動名稱").fill("Tor 節點工作坊");
  await page.getByLabel("開始").fill("2026-10-20T19:00");
  await page.getByLabel("地點").fill("台北");
  const png = await downloadFrom(page, () => page.getByRole("button", { name: "下載 PNG" }).click());
  expect(png.name).toBe("event-qrcode.png");
  expect(decodeQrPng(png.data)).toBe((eventPayload({ title: "Tor 節點工作坊", start: "2026-10-20T19:00", end: "", location: "台北" }) as { text: string }).text);

  await page.getByLabel("結束（可以不填）").fill("2026-10-20T18:00");
  await expect(page.getByRole("alert")).toContainText("結束的時間早於開始的時間");
});

test("位置、電話與簡訊，切換格式時填過的號碼留著", async ({ page }) => {
  await page.goto("./qrcode/");
  await page.getByRole("radio", { name: "位置" }).check();
  await page.getByLabel("座標").fill("25.0330, 121.5654");
  let png = await downloadFrom(page, () => page.getByRole("button", { name: "下載 PNG" }).click());
  expect(decodeQrPng(png.data)).toBe("geo:25.0330,121.5654");

  await page.getByRole("radio", { name: "電話" }).check();
  await page.getByLabel("電話號碼").fill("+886 2 1234 5678");
  png = await downloadFrom(page, () => page.getByRole("button", { name: "下載 PNG" }).click());
  expect(png.name).toBe("phone-qrcode.png");
  expect(decodeQrPng(png.data)).toBe("tel:+886212345678");

  await page.getByRole("radio", { name: "簡訊" }).check();
  await expect(page.getByLabel("電話號碼")).toHaveValue("+886 2 1234 5678");
  await page.getByLabel("訊息").fill("我到了");
  png = await downloadFrom(page, () => page.getByRole("button", { name: "下載 PNG" }).click());
  expect(decodeQrPng(png.data)).toBe("SMSTO:+886212345678:我到了");
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
  await expect(page.getByRole("heading", { name: "交出去之前" })).toBeVisible();
});

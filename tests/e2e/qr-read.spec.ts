import { encodeQr, MARGIN, qrPng } from "../../src/tools/qrcode/index.ts";
import { big5Invoice, encodeBytes } from "../helpers/qr-decode.ts";
import { barcodePng, bcbp } from "../helpers/barcodes.ts";
import samples from "../../src/tools/qr-read/samples.json" with { type: "json" };
import { expect, test } from "./guard.ts";

const png = (text: string) => Buffer.from(qrPng(encodeQr(text, "M"), 6));

test.beforeEach(async ({ page }) => {
  await page.route("**/gears/data/165.txt", (route) => route.fulfill({ body: "# from=2025-12 to=2026-09 count=1\nscam-shop.cc\n" }));
});

test("從照片讀出網址，再交給網址檢查", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("link", { name: /QR code 與條碼讀取/ }).click();
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
  await expect(page.getByTestId("qr-fields")).toContainText("Wi-Fi");
  await expect(page.getByTestId("qr-fields").getByText("anoni-cafe", { exact: true })).toBeVisible();
  await expect(page.getByText("secret pass", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "複製密碼" })).toBeVisible();
});

test("付款與兩步驟驗證的 QR code 拆成欄位，另外提醒", async ({ page }) => {
  await page.goto("./qr-read/");
  const address = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
  await page.getByTestId("qr-input").setInputFiles({ name: "pay.png", mimeType: "image/png", buffer: png(`bitcoin:${address}?amount=0.001&label=anoni.net`) });
  await expect(page.getByTestId("qr-fields")).toContainText("Bitcoin");
  await expect(page.getByTestId("qr-fields").getByText(address, { exact: true })).toBeVisible();
  await expect(page.getByText("付款前核對收款地址的開頭與結尾")).toBeVisible();
  await expect(page.getByRole("button", { name: "複製地址" })).toBeVisible();

  await page.getByTestId("qr-input").setInputFiles({ name: "otp.png", mimeType: "image/png", buffer: png("otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example") });
  await expect(page.getByTestId("qr-fields")).toContainText("兩步驟驗證");
  await expect(page.getByTestId("qr-fields")).toContainText("alice");
  await expect(page.getByText("拍到這張 QR code 的人都能產生同一組驗證碼")).toBeVisible();
});

test("聯絡資料與簡訊在打開之前先列出內容", async ({ page }) => {
  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "card.png", mimeType: "image/png", buffer: png("MECARD:N:陳,小明;TEL:0912345678;EMAIL:ming@example.org;;") });
  await expect(page.getByTestId("qr-fields")).toContainText("聯絡資料");
  await expect(page.getByTestId("qr-fields")).toContainText("陳小明");
  await expect(page.getByTestId("qr-fields")).toContainText("ming@example.org");

  await page.getByTestId("qr-input").setInputFiles({ name: "sms.png", mimeType: "image/png", buffer: png("SMSTO:0204000000:訂閱") });
  await expect(page.getByTestId("qr-fields")).toContainText("0204000000");
  await expect(page.getByText("陌生的號碼可能是付費簡訊")).toBeVisible();
});

test("Big5 編碼的電子發票拆出號碼、金額與品項，暫存區的收據照片也一樣", async ({ page }) => {
  const photo = Buffer.from(qrPng(encodeBytes(big5Invoice()), 6));
  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: photo });
  const fields = page.getByTestId("qr-fields");
  await expect(fields).toContainText("電子發票");
  await expect(fields).toContainText("AB-11223344");
  await expect(fields).toContainText("2013-05-23");
  await expect(fields).toContainText("340 元");
  await expect(fields).toContainText("乾電池 × 1，單價 105 元");
  await expect(fields).toContainText("列出 1 項，發票上共 3 項");
  await expect(page.getByText("分享發票或收據的照片之前")).toBeVisible();

  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByRole("heading", { name: "圖片裡的 QR code" })).toBeVisible();
  await expect(page.getByTestId("qr-fields")).toContainText("乾電池");
});

test("登機證的 PDF417 拆出姓名、訂位代號與航班，暫存區的照片也讀得出來", async ({ page }) => {
  const photo = await barcodePng(bcbp({ name: "WANG/XIAOMING MR", pnr: "ABC123", from: "TPE", to: "NRT", carrier: "CI", flight: "100", day: 293, seat: "12A" }), "PDF417");
  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "boarding.png", mimeType: "image/png", buffer: photo });
  const fields = page.getByTestId("qr-fields");
  await expect(fields).toContainText("PDF417");
  await expect(fields).toContainText("登機證");
  await expect(fields).toContainText("WANG/XIAOMING MR");
  await expect(fields).toContainText("ABC123");
  await expect(fields).toContainText("CI100，TPE → NRT");
  await expect(fields).toContainText("座位 12A");
  await expect(page.getByText("有了訂位代號與姓氏")).toBeVisible();

  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "boarding.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByRole("heading", { name: "圖片裡的條碼" })).toBeVisible();
  await expect(page.getByTestId("qr-fields")).toContainText("ABC123");
});

test("商品條碼列出申請國，暫存區的照片不列商品條碼", async ({ page }) => {
  const photo = await barcodePng("4710088412348", "EAN13");
  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: photo });
  const fields = page.getByTestId("qr-fields");
  await expect(fields).toContainText("EAN-13");
  await expect(fields).toContainText("商品條碼");
  await expect(fields).toContainText("台灣");
  await expect(page.getByText("不一定是產地")).toBeVisible();

  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByTestId("file-input").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByRole("heading", { name: "product.png" })).toBeVisible();
  // 給自動讀取一點時間，確定沒有出現
  await page.waitForTimeout(1500);
  await expect(page.getByRole("heading", { name: "圖片裡的條碼" })).toHaveCount(0);
});

test("電子發票的一維條碼與 Tor bridge 的 QR code", async ({ page }) => {
  await page.goto("./qr-read/");
  await page.getByTestId("qr-input").setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: await barcodePng("11410AB123456789999", "Code39") });
  await expect(page.getByTestId("qr-fields")).toContainText("電子發票的一維條碼");
  await expect(page.getByTestId("qr-fields")).toContainText("2025 年 9-10 月");

  const line = "obfs4 192.0.2.10:443 0123456789ABCDEF0123456789ABCDEF01234567 cert=AbCd iat-mode=0";
  await page.getByTestId("qr-input").setInputFiles({ name: "bridge.png", mimeType: "image/png", buffer: png(line) });
  await expect(page.getByTestId("qr-fields")).toContainText("Tor bridge（1 個）");
  await expect(page.getByText("很快會被封鎖")).toBeVisible();
  await expect(page.getByRole("button", { name: "複製 bridge" })).toBeVisible();

  await page.getByTestId("qr-input").setInputFiles({ name: "fido.png", mimeType: "image/png", buffer: png("FIDO:/1234567890123456789012345678901234567890") });
  await expect(page.getByTestId("qr-fields")).toContainText("passkey 跨裝置登入");
  await expect(page.getByText("掃了等於讓對方用你的帳號登入")).toBeVisible();
});

test("範例頁的每一張 QR code 與條碼，用讀取工具打開都讀得出來", async ({ page }) => {
  await page.goto("./qr-read/");
  await page.getByTestId("sample-link").click();
  await expect(page).toHaveURL(/\/gears\/samples\/$/);
  await expect(page.getByRole("heading", { name: "分享前要遮住" })).toBeVisible();
  for (const sample of samples) {
    await page.locator(`[data-sample="${sample.id}"]`).click();
    await expect(page).toHaveURL(/\/gears\/qr-read\/$/);
    const text = sample.bytes ? new TextDecoder("big5").decode(Buffer.from(sample.bytes, "hex")) : sample.text!;
    await expect(page.getByTestId("qr-text"), sample.id).toHaveText(text);
    await page.goBack();
  }
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
  await expect(page.getByRole("alert")).toContainText("照片裡找不到 QR code 或條碼");
});

test("暫存區裡的圖片含有 QR code，檔案畫面自動讀出來", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "ticket.png", mimeType: "image/png", buffer: png("訂位代號 ABC123 王小明") });
  await expect(page.getByRole("heading", { name: "圖片裡的 QR code" })).toBeVisible();
  await expect(page.getByTestId("qr-text")).toHaveText("訂位代號 ABC123 王小明");
});

import { test as base, expect, type Page } from "@playwright/test";
import { exifSegment, insertIntoJpeg, sampleTiff } from "../helpers/fixtures.ts";
import { encodeQr, qrPng } from "../../src/tools/qrcode/index.ts";

// 使用統計只在 anoni.net 上送出。其他測試都在 localhost 上執行，guard.ts 會擋下任何對外連線，
// 這裡另外把 anoni.net 指到 localhost 的預覽伺服器（只有 Chromium 能改主機解析，CI 上預覽伺服器只聽 ::1，
// 所以寫 localhost 不寫 127.0.0.1），攔下送到 Umami 的請求，
// 確認送出的只有白名單裡的東西。
const test = base.extend({});
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "只有 Chromium 能改主機解析");
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP anoni.net localhost"] } });

const SEND = "https://aa.anoni.net/api/send";

async function open(page: Page, baseURL: string) {
  const sent: Record<string, unknown>[] = [];
  await page.route(SEND, async (route) => {
    if (route.request().method() === "POST") sent.push(route.request().postDataJSON().payload);
    await route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }, body: "{}" });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // 測試用 http 連到預覽伺服器，不是 localhost 的 http 頁面會略過 COOP 並留下這則訊息，正式站是 HTTPS
  page.on("console", (m) => m.type() === "error" && !m.text().includes("Cross-Origin-Opener-Policy header has been ignored") && errors.push(m.text()));
  const url = new URL(baseURL);
  url.hostname = "anoni.net";
  await page.goto(`${url.href}?utm_source=test#top`);
  return { sent, errors, home: url.href };
}

async function canvasJpeg(page: Page): Promise<Uint8Array> {
  const bytes = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(32, 24);
    canvas.getContext("2d")!.fillRect(0, 0, 32, 24);
    const blob = await canvas.convertToBlob({ type: "image/jpeg" });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return new Uint8Array(bytes);
}

test("頁面瀏覽、任務、加入檔案、處理完成與下載，不含檔名與查詢字串", async ({ page, baseURL }) => {
  const { sent, errors } = await open(page, baseURL!);
  await expect.poll(() => sent.length).toBe(1);
  const view = sent[0] as Record<string, string>;
  expect(view.url).toBe("/gears/");
  expect(view.name).toBeUndefined();
  expect(view.website).toBe("bfcd8990-a763-4213-8753-6c484c164d8c");
  expect(view.screen).toMatch(/^\d+00x\d+00$/);

  const jpeg = insertIntoJpeg(await canvasJpeg(page), exifSegment(sampleTiff(1)));
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /照片與影片的拍攝位置/ }).click();
  await (await chooser).setFiles({ name: "IMG_SECRET_NAME.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg) });
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "下載" }).click();
  await download;

  await expect.poll(() => sent.map((s) => s.name ?? `view ${s.url}`)).toEqual([
    "view /gears/",
    "task",
    "view /gears/strip-metadata/",
    "file-add",
    "tool-done",
    "save",
  ]);
  const events = Object.fromEntries(sent.filter((s) => s.name).map((s) => [s.name, s.data]));
  expect(events).toEqual({
    task: { task: "photo" },
    "file-add": { kind: "image" },
    "tool-done": { tool: "strip-metadata" },
    save: { how: "download" },
  });
  expect(JSON.stringify(sent)).not.toContain("SECRET");
  expect(JSON.stringify(sent)).not.toContain("utm_source");
  expect(errors).toEqual([]);
});

test("QR code 只記格式，不送內容", async ({ page, baseURL }) => {
  const { sent, errors, home } = await open(page, baseURL!);
  await page.goto(`${home}qrcode/`);
  await page.getByRole("radio", { name: "聯絡資料" }).check();
  await page.getByLabel("姓名").fill("SECRET 王小明");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 PNG" }).click();
  await download;

  await page.goto(`${home}qr-read/`);
  await page.getByTestId("qr-input").setInputFiles({ name: "pay.png", mimeType: "image/png", buffer: Buffer.from(qrPng(encodeQr("bitcoin:SECRETADDRESS?amount=1", "M"), 6)) });
  await expect(page.getByTestId("qr-fields")).toContainText("Bitcoin");
  // 範例不記：QR code 的範例，以及放進暫存區的範例檔、處理與下載
  await page.getByTestId("sample-link").click();
  await page.locator('[data-sample="wifi"]').click();
  await expect(page.getByTestId("qr-fields")).toContainText("anoni-cafe");
  await page.goBack();
  await page.locator('[data-sample="photo"]').click();
  await expect(page.getByTestId("sample-note")).toBeVisible();
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();

  await expect.poll(() => sent.filter((s) => s.name).map((s) => [s.name, s.data])).toEqual([
    ["tool-done", { tool: "qrcode" }],
    ["qr-make", { format: "contact" }],
    ["save", { how: "download" }],
    ["tool-done", { tool: "qr-read" }],
    ["qr-read", { format: "payment" }],
  ]);
  expect(sent.filter((s) => !s.name).map((s) => s.url)).toContain("/gears/samples/");
  expect(JSON.stringify(sent)).not.toContain("SECRET");
  expect(errors).toEqual([]);
});

test("瀏覽器要求不追蹤時不送，頁尾只說明不記錄，不提 Umami", async ({ page, baseURL }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" }));
  const { sent } = await open(page, baseURL!);
  await expect(page.getByTestId("analytics")).toHaveText("你的瀏覽器要求不追蹤，這裡不記錄使用統計。");
  await expect(page.getByTestId("analytics").getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: /可疑的通知信/ }).click();
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
});

test("頁尾選了不要記錄之後就不送，重新整理也一樣", async ({ page, baseURL }) => {
  const { sent, home } = await open(page, baseURL!);
  await expect.poll(() => sent.length).toBe(1);
  await page.getByTestId("analytics").getByRole("button", { name: "不要記錄" }).click();
  await expect(page.getByTestId("analytics")).toContainText("這個瀏覽器已經停止記錄。");
  await page.getByRole("button", { name: /可疑的通知信/ }).click();
  await page.goto(home);
  await expect(page.getByTestId("analytics").getByRole("button", { name: "恢復記錄" })).toBeVisible();
  await page.waitForTimeout(500);
  expect(sent.length).toBe(1);

  await page.getByTestId("analytics").getByRole("button", { name: "恢復記錄" }).click();
  await page.getByRole("button", { name: /可疑的通知信/ }).click();
  await expect.poll(() => sent.map((s) => s.name ?? s.url)).toEqual(["/gears/", "task", "/gears/email-check/"]);
});

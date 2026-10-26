import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { exifSegment, insertIntoJpeg, sampleTiff } from "../helpers/fixtures.ts";
import { LEGIT_EML } from "../helpers/emails.ts";
import { trackedDocx } from "../helpers/tracked-docs.ts";
import { expect, test } from "./guard.ts";

// 檔案畫面的工具列表（src/ui/shelf.ts）：照桌面的三組排列，建議附上理由

async function photo(page: Page): Promise<Buffer> {
  const data = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    c.getContext("2d")!.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(insertIntoJpeg(new Uint8Array(data), exifSegment(sampleTiff())));
}

const groupTitles = (page: Page) => page.locator(".shelf-group h4");
const item = (page: Page, name: string) => page.locator(".shelf li", { has: page.getByText(name, { exact: true }) });

test("從桌面加入照片：交出去之前在前面，建議附上理由，加密在安全地傳送", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await photo(page) });
  await expect(groupTitles(page)).toHaveText(["交出去之前", "安全地傳送", "檢查收到的"]);
  await expect(item(page, "清除中繼資料")).toContainText("檔案裡有拍攝位置、相機或手機型號");
  await expect(item(page, "縮成常見尺寸")).toContainText("建議");
  await expect(page.locator(".shelf-group").nth(1).locator(".shelf li")).toHaveCount(1);
});

test("從「收到的照片與文件」加入：檢查收到的在前面，建議查證，不建議清除", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("link", { name: /收到的照片與文件/ }).click()]);
  await chooser.setFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await photo(page) });
  await page.locator(".tray .item", { hasText: "IMG_0001.jpg" }).click();
  await expect(groupTitles(page).first()).toHaveText("檢查收到的");
  await expect(item(page, "查證檔案")).toContainText("可以查證的線索");
  await expect(item(page, "清除中繼資料")).not.toContainText("建議");
  await item(page, "查證檔案").getByRole("button", { name: "開啟" }).click();
  await expect(page).toHaveURL(/\/verify\/$/);
});

test("有巨集的 Word：說明改指向開啟前檢查，建議附上連線的數量", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "invite.docm", mimeType: "application/octet-stream", buffer: Buffer.from(await trackedDocx()) });
  await expect(page.getByText("有巨集的文件不清除中繼資料", { exact: false })).toBeVisible();
  await expect(groupTitles(page).first()).toHaveText("檢查收到的");
  await expect(item(page, "文件開啟前檢查")).toContainText("打開時會連到 4 個外部位址");
});

test("信件：從暫存區打開信件檢查，帶著這封信", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "mail.eml", mimeType: "message/rfc822", buffer: Buffer.from(LEGIT_EML) });
  await expect(item(page, "信件檢查")).toContainText("看這封信實際從哪裡寄來");
  await item(page, "信件檢查").getByRole("button", { name: "開啟" }).click();
  await expect(page).toHaveURL(/\/email-check\/$/);
  await expect(page.getByTestId("email-verdict")).toBeVisible();
});

test("下載的檔案與簽章檔：從暫存區打開下載的軟體驗證，兩個檔案一起帶過去", async ({ page }) => {
  const dir = new URL("../helpers/signed/", import.meta.url);
  const name = "tor-browser-15.0.25-sha256sums.txt";
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles([
    { name, mimeType: "text/plain", buffer: readFileSync(new URL(name, dir)) },
    { name: `${name}.asc`, mimeType: "application/pgp-signature", buffer: readFileSync(new URL(`${name}.asc`, dir)) },
  ]);
  await page.locator(".tray .item", { hasText: `${name}.asc` }).click();
  await expect(page.getByText("這是 OpenPGP 簽章檔", { exact: false })).toBeVisible();
  await expect(item(page, "下載的軟體驗證")).toContainText("這是簽章檔");
  await item(page, "下載的軟體驗證").getByRole("button", { name: "開啟" }).click();
  await expect(page.getByTestId("software-verdict")).toContainText("簽章正確");
});

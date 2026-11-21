import type { Page } from "@playwright/test";
import { expect } from "./guard.ts";

// 遠端傳送的測試共用的步驟（remote.spec.ts、remote-call.spec.ts）

const random = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7919 + (i >> 8)) & 255));

// 送出端：暫存區放兩個檔案，打開遠端傳送，產生連結，回傳分享連結
export async function startSender(page: Page): Promise<string> {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("遠端傳送的測試\n".repeat(50)) },
    { name: "data.bin", mimeType: "application/octet-stream", buffer: random },
  ]);
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.getByRole("link", { name: /^遠端傳送/ }).click();
  await page.getByRole("button", { name: "送出暫存區的檔案" }).click();
  await expect(page.getByTestId("remote-privacy")).toContainText("Cloudflare");
  await page.getByRole("button", { name: "產生連結（2 個檔案）" }).click();
  await expect(page.getByTestId("remote-status")).toContainText("等對方打開連結");
  return page.getByTestId("remote-link").inputValue();
}

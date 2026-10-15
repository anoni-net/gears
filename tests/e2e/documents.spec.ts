import type { Page } from "@playwright/test";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { CONTENT_FINDINGS } from "../../src/core/tool.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { syntheticDocx, syntheticPdf, syntheticXlsx } from "../helpers/documents.ts";
import { downloadFrom, expect, test } from "./guard.ts";

async function add(page: Page, name: string, data: Uint8Array) {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer: Buffer.from(data) });
}

async function cleanAndDownload(page: Page, format: Format) {
  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toBe(`gears-1.${format}`);
  expect(sniff(file.data)).toBe(format);
  const after = await stripMetadata.inspect(file.data, format);
  expect(after.every((f) => CONTENT_FINDINGS.includes(f.code))).toBe(true);
}

test("Word：列出作者與註解，清除後註解與修訂另外提醒", async ({ page }) => {
  await add(page, "plan.docx", await syntheticDocx());
  await expect(page.getByText("Jane Doe", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("C:/Users/janedoe", { exact: false }).first()).toBeVisible();
  const content = page.getByTestId("content-findings");
  await expect(content.getByText(/^追蹤修訂，/)).toBeVisible();
  await expect(content.getByText(/^註解，/)).toBeVisible();
  await cleanAndDownload(page, "docx");
  // 內容類的提醒清除之後仍然在
  await expect(content.getByText(/^追蹤修訂，/)).toBeVisible();
  await expect(page.getByText("文件摘要", { exact: false })).toBeVisible();
});

test("Excel：暫存區顯示找到的項目，清除後下載", async ({ page }) => {
  await add(page, "budget.xlsx", await syntheticXlsx());
  await expect(page.locator(".item .status.warn")).toBeVisible();
  await expect(page.getByText("SECRET-PRINTER")).toBeVisible();
  await cleanAndDownload(page, "xlsx");
  await expect(page.locator(".item .status.warn")).toHaveCount(0);
});

test("PDF：打開時才載入 pdf-lib，清除後下載", async ({ page }) => {
  await add(page, "report.pdf", await syntheticPdf());
  await expect(page.getByText("Jane Doe", { exact: false }).first()).toBeVisible();
  await cleanAndDownload(page, "pdf");
  await expect(page.getByText("沒有用到的物件", { exact: false })).toBeVisible();
});

test("Word：勾選刪除註解與接受修訂，套用之後兩者都不在", async ({ page }) => {
  await add(page, "plan.docx", await syntheticDocx());
  const content = page.getByTestId("content-findings");
  const apply = content.getByRole("button", { name: "套用，同時清除中繼資料" });
  await expect(apply).toBeDisabled();
  await content.getByRole("checkbox", { name: /刪除所有註解/ }).check();
  await content.getByRole("checkbox", { name: /接受所有追蹤修訂/ }).check();
  await apply.click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  // 測試檔裡還有一個沒有辦法檢查的內嵌物件，那一項仍然列著，註解與修訂的選項不見了
  await expect(content.getByRole("checkbox")).toHaveCount(0);
  await expect(content.getByText(/^註解，|^追蹤修訂，/)).toHaveCount(0);
  await expect(page.getByText("註解（依你的選擇刪除）")).toBeVisible();
  await expect(page.getByText("追蹤修訂（依你的選擇全部接受，刪除的文字一併拿掉）")).toBeVisible();
  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  const left = (await stripMetadata.inspect(file.data, "docx")).map((f) => f.code);
  expect(left).toEqual(["attachments"]);
});

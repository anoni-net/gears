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

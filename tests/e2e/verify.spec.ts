import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { syntheticJpeg } from "../helpers/fixtures.ts";
import { downloadFrom, expect, test } from "./guard.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// 存了兩個版本的 PDF：第二版接在第一版後面，模擬增量更新
async function twoVersionPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  doc.setAuthor("Reporter A");
  doc.setCreationDate(new Date("2024-06-01T02:00:00Z"));
  const first = await doc.save({ useObjectStreams: false });
  doc.addPage([200, 200]);
  doc.setModificationDate(new Date("2024-06-02T02:00:00Z"));
  const second = await doc.save({ useObjectStreams: false });
  return Buffer.concat([first, second]);
}

test("從任務選照片與 PDF：雜湊值、時間線、裝置、人名、位置、PDF 的舊版本與查證紀錄", async ({ page }) => {
  const photo = Buffer.from(syntheticJpeg());
  const pdf = await twoVersionPdf();
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /查證收到的照片與文件/ }).click()]);
  await chooser.setFiles([
    { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "report.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);

  // 加入檔案之後留在查證的畫面
  await expect(page.getByRole("heading", { name: "查證檔案" })).toBeVisible();
  // 檔案清單裡的名稱。編輯痕跡的小標題也會寫出檔案名稱，限定在清單裡
  const list = page.locator(".verify-files");
  await expect(list.getByText("檔案 1：photo.jpg")).toBeVisible();
  await expect(list.getByText("檔案 2：report.pdf")).toBeVisible();
  await expect(page.getByTestId("verify-hash")).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByTestId("verify-hash").first()).toHaveText(`SHA-256 ${sha256(photo)}`);
  await expect(page.getByTestId("verify-hash").nth(1)).toHaveText(`SHA-256 ${sha256(pdf)}`);

  await expect(page.getByText("檔案 2 存了 2 個版本，較早的版本可以在「編輯痕跡」取出來看。")).toBeVisible();
  await expect(page.getByText("拍攝（EXIF）")).toBeVisible();
  await expect(page.getByText("2024-06-01 02:00:00 +00:00")).toBeVisible();
  await expect(page.getByText("裝置：TestMaker SECRET-MODEL")).toBeVisible();
  await expect(page.getByText("作者：Reporter A")).toBeVisible();
  await expect(page.getByText("相機設定的擁有者：Jane Doe")).toBeVisible();
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();

  // 取出舊版本：放進暫存區，也算進這一批
  await page.getByRole("button", { name: "取出第 1 版" }).click();
  await expect(list.getByText("檔案 3：report-v1.pdf")).toBeVisible();
  await expect(page.getByTestId("verify-hash")).toHaveCount(3, { timeout: 15000 });

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "下載查證紀錄" }).click());
  expect(file.name).toMatch(/^gears-verify-\d{12}\.md$/);
  const report = Buffer.from(file.data).toString("utf8");
  expect(report).toContain("# 查證紀錄");
  expect(report).toContain(`SHA-256：\`${sha256(photo)}\``);
  expect(report).toContain(`SHA-256：\`${sha256(pdf)}\``);
  expect(report).toContain("### 檔案 3：report-v1.pdf");
  expect(report).toContain("25.03300, 121.56540（檔案 1）");

  // 放進暫存區的查證紀錄不算進這一批
  await page.getByRole("button", { name: "放進暫存區" }).click();
  await expect(page.getByText(/gears-verify-\d{12}\.md/).first()).toBeVisible();
  await expect(list.getByText(/^檔案 4：/)).toHaveCount(0);
});

test("暫存區沒有檔案時，只顯示說明與選擇檔案", async ({ page }) => {
  await page.goto("./verify/");
  await expect(page.getByText(/這些只是線索/)).toBeVisible();
  await expect(page.getByRole("button", { name: "選擇檔案" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "時間線" })).toHaveCount(0);
});

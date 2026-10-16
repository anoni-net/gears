import { createHash } from "node:crypto";
import { syntheticJpeg } from "../helpers/fixtures.ts";
import { incrementalPdf } from "../helpers/pdf-incremental.ts";
import { downloadFrom, expect, test } from "./guard.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

test("從任務選照片與 PDF：雜湊值、時間線、裝置、人名、位置、PDF 的舊版本與查證紀錄", async ({ page }) => {
  const photo = Buffer.from(syntheticJpeg());
  const { bytes, firstEnd } = await incrementalPdf();
  const pdf = Buffer.from(bytes);
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /查證收到的照片與文件/ }).click()]);
  await chooser.setFiles([
    { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "report.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);

  // 加入檔案之後留在查證的畫面
  await expect(page.getByRole("heading", { name: "查證檔案" })).toBeVisible();
  const cards = page.locator(".verify-card");
  await expect(cards.getByRole("heading", { name: "photo.jpg" })).toBeVisible();
  await expect(cards.getByRole("heading", { name: "report.pdf" })).toBeVisible();
  // 雜湊值收在完整資訊裡
  await expect(page.getByTestId("verify-hash")).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByTestId("verify-hash").first()).toHaveText(sha256(photo));
  await expect(page.getByTestId("verify-hash").nth(1)).toHaveText(sha256(pdf));
  await expect(page.getByTestId("verify-hash").first()).toBeHidden();
  await cards.first().getByText("完整資訊（雜湊值與所有時間）").click();
  await expect(page.getByTestId("verify-hash").first()).toBeVisible();

  // 總覽與需要留意的地方：用檔名稱呼，寫出可能的原因
  await expect(page.getByText("2 個檔案，有 1 個地方需要留意。")).toBeVisible();
  const warnings = page.locator(".verify-warnings");
  await expect(warnings.getByText("存著較早的版本")).toBeVisible();
  await expect(warnings.getByText("report.pdf 裡存了 2 個版本，修改時舊的內容留在檔案裡。可以在檔案的版本紀錄裡比對各版本改了什麼。")).toBeVisible();
  await expect(cards.nth(1).getByText("需要留意：存著較早的版本")).toBeVisible();

  // 每個檔案的重點
  const photoCard = cards.first();
  await expect(photoCard.getByText("照片 · JPG")).toBeVisible();
  await expect(photoCard.getByText("2026-10-14 09:30:00（沒有時區）").first()).toBeVisible();
  await expect(photoCard.getByText("TestMaker SECRET-MODEL")).toBeVisible();
  await expect(photoCard.getByText("相機設定的擁有者 Jane Doe")).toBeVisible();
  await expect(photoCard.getByText("25.03300, 121.56540")).toBeVisible();
  const pdfCard = cards.nth(1);
  await expect(pdfCard.getByText("2024-06-01 02:00:00（UTC+00:00）").first()).toBeVisible();
  await expect(pdfCard.getByText("作者 Reporter A")).toBeVisible();

  // 兩個以上的檔案才有關聯與合併的時間線，時間線預設收起來
  await expect(page.getByRole("heading", { name: "檔案之間的關聯" })).toBeVisible();
  await expect(page.getByText("這些檔案之間沒有共同的裝置、軟體或人名。")).toBeVisible();
  await expect(page.locator(".verify-timeline")).toBeHidden();

  // 版本紀錄：列在原檔的卡片裡，不放進暫存區
  await expect(pdfCard.getByText("這份 PDF 存了 2 個版本。")).toBeVisible();
  await expect(pdfCard.getByText("第 2 版（目前的版本）")).toBeVisible();
  const old = await downloadFrom(page, () => pdfCard.getByRole("button", { name: "下載第 1 版" }).click());
  expect(old.name).toBe("report-v1.pdf");
  expect(Buffer.from(old.data).equals(pdf.subarray(0, firstEnd))).toBe(true);

  // 比對：中繼資料、文字與畫面
  await pdfCard.getByRole("button", { name: "跟第 2 版比對" }).click();
  const compare = page.getByTestId("verify-compare");
  await expect(compare.getByText("第 1 版與第 2 版的差異")).toBeVisible();
  await expect(compare.getByText("修改時間：沒有 → 2024-06-02 02:00:00（UTC+00:00）")).toBeVisible();
  await expect(compare.getByText("第 1 頁：有變動")).toBeVisible({ timeout: 15000 });
  await expect(compare.locator(".verify-text-diff .removed")).toHaveText(["刪掉的文字：− Amount 100"]);
  await expect(compare.locator(".verify-text-diff .added")).toHaveText(["加入的文字：+ Amount 900"]);
  await expect(compare.getByRole("img")).toHaveCount(2);
  await expect(compare.getByText("其他 1 頁沒有找到差異。")).toBeVisible();
  await expect(cards).toHaveCount(2);

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "下載查證紀錄" }).click());
  expect(file.name).toMatch(/^gears-verify-\d{12}\.md$/);
  const report = Buffer.from(file.data).toString("utf8");
  expect(report).toContain("# 查證紀錄");
  expect(report).toContain("2 個檔案，有 1 個地方需要留意。");
  expect(report).toContain("- **存著較早的版本**：report.pdf 裡存了 2 個版本");
  expect(report).toContain(`SHA-256：\`${sha256(photo)}\``);
  expect(report).toContain(`SHA-256：\`${sha256(pdf)}\``);
  expect(report).toContain("- 位置：25.03300, 121.56540");

  // 放進暫存區的查證紀錄不算進這一批
  await page.getByRole("button", { name: "放進暫存區" }).click();
  await expect(page.getByText(/gears-verify-\d{12}\.md/).first()).toBeVisible();
  await expect(cards).toHaveCount(2);
});

test("暫存區沒有檔案時，只顯示說明與選擇檔案", async ({ page }) => {
  await page.goto("./verify/");
  await expect(page.getByText(/有矛盾不代表造假/)).toBeVisible();
  await expect(page.getByRole("button", { name: "選擇檔案" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "時間線" })).toHaveCount(0);
});

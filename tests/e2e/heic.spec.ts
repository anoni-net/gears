import { sniff } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { syntheticHeif } from "../helpers/fixtures.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 這裡的 HEIC 是在測試裡組出來的，結構完整但不能解碼，所以預覽會說明沒有辦法顯示。
// 能解碼的真 HEIC 在 heic-decode.spec.ts。
test("HEIC：列出拍攝位置，清除之後下載的檔案找不到任何資訊", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from(syntheticHeif()) });
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();
  await expect(page.getByText("沒有辦法顯示這張圖片，中繼資料照樣能檢查與清除。")).toBeVisible();
  await expect(page.locator(".tray .item")).toContainText("找到");
  // 縮圖載入失敗時不留破圖
  await expect(page.locator(".tray .item img")).toHaveCount(0);

  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  await expect(page.getByText("影像、縮圖與旋轉方向，原封不動")).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toBe("gears-1.heic");
  expect(sniff(file.data)).toBe("heic");
  expect((await stripMetadata.inspect(file.data, "heic"))).toEqual([]);
});

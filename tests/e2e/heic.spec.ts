import { sniff } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { syntheticHeif } from "../helpers/fixtures.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// 測試用的 HEIC 結構完整但不能解碼，所以每個瀏覽器都會顯示「不能顯示」的說明。
// 真的 Safari 能顯示 HEIC，這一點要在實機上確認。
test("HEIC：列出拍攝位置，清除之後下載的檔案找不到任何資訊", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: Buffer.from(syntheticHeif()) });
  await expect(page.getByText("拍攝位置", { exact: true })).toBeVisible();
  await expect(page.getByText("25.03300, 121.56540")).toBeVisible();
  await expect(page.getByText("這個瀏覽器不能顯示 HEIC，Safari 可以")).toBeVisible();
  await expect(page.locator(".tray .item")).toContainText("找到");
  // 縮圖載入失敗時不留破圖
  await expect(page.locator(".tray .item img")).toHaveCount(0);

  await page.getByRole("button", { name: "清除", exact: true }).click();
  await expect(page.getByText("沒有找到可能透露身分的中繼資料。")).toBeVisible();
  await expect(page.getByText("影像、縮圖與旋轉方向，原封不動")).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(file.name).toBe("gears-1.heic");
  expect(sniff(file.data)).toBe("heic");
  expect(stripMetadata.inspect(file.data, "heic")).toEqual([]);
  // 遮蔽要把影像解碼，HEIC 目前不提供
  await expect(page.getByRole("button", { name: "開始框選" })).toHaveCount(0);
});

import { expect, test } from "./guard.ts";

test("隱私說明：從頁尾打開，每一節都有內容，進 sitemap", async ({ page, request }) => {
  await page.goto("./");
  await page.getByTestId("privacy-link").click();
  await expect(page).toHaveURL(/\/gears\/privacy\/$/);
  const privacy = page.getByTestId("privacy");
  await expect(privacy.getByRole("heading", { name: "隱私說明", level: 1 })).toBeVisible();
  for (const name of ["在瀏覽器裡處理的部分", "打開 Gears 時", "onion 版", "使用統計", "建議與回饋、裝置量測的結果", "下載模型", "遠端傳送", "留在你裝置上的資料", "問題回報"])
    await expect(privacy.getByRole("heading", { name, level: 3 })).toBeVisible();
  // 存取紀錄照實寫出來
  await expect(privacy).toContainText("保留 52 天");
  // 每一項都有對應的字串，不會露出 privacy.xxx 這種鍵
  await expect(privacy).not.toContainText("privacy.");
  await privacy.getByRole("button", { name: "遠端傳送的伺服器說明" }).click();
  await expect(page).toHaveURL(/\/gears\/remote-server\/$/);

  const sitemap = await (await request.get("./sitemap.xml")).text();
  expect(sitemap).toContain("/gears/privacy/");
  const html = await (await request.get("./en/privacy/")).text();
  expect(html).toContain("<title>Privacy | Gears</title>");
});

import { expect, test } from "./guard.ts";

// 搜尋引擎讀得到的內容（#164）：建置時寫進每一頁 HTML 的說明（src/static-content.ts）、
// 桌面的工具是連結、工具頁的 <h1> 是工具名稱

test("原始的 HTML 寫著這一頁的標題、說明與連結，打開之後換成工作台", async ({ page, request }) => {
  const html = await (await request.get("./strip-metadata/")).text();
  expect(html).toContain("<h1>清除中繼資料</h1>");
  expect(html).toContain("<h2>使用方式</h2>");
  expect(html).toContain('<a href="/gears/redact/">遮蔽</a>');
  const home = await (await request.get("./en/")).text();
  expect(home).toContain('<a href="/gears/en/transcribe/">Transcript</a>');

  await page.goto("./strip-metadata/");
  await expect(page.getByRole("heading", { name: "清除中繼資料", level: 1 })).toBeVisible();
  await expect(page.locator(".static-page")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(1);
  // 頁首的網站名稱在工具頁不是標題
  await expect(page.locator(".site-header__title")).toHaveJSProperty("tagName", "P");
});

test("桌面與檔案畫面的 h1 是網站名稱", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1.site-header__title")).toBeVisible();
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1.site-header__title")).toBeVisible();
});

test("桌面的工具是連到工具網址的連結，點了不重新載入，暫存區的檔案留著", async ({ page }) => {
  await page.goto("./");
  const row = page.getByRole("link", { name: /^網址檢查/ });
  await expect(row).toHaveAttribute("href", "/gears/url-check/");
  await expect(page.locator(".desk-user").getByRole("link", { name: "範例" })).toHaveAttribute("href", "/gears/samples/");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("button", { name: "回到桌面" }).click();
  await page.evaluate(() => ((window as unknown as { __same: boolean }).__same = true));
  await page.getByRole("link", { name: /^網址檢查/ }).click();
  await expect(page).toHaveURL(/\/gears\/url-check\/$/);
  expect(await page.evaluate(() => (window as unknown as { __same?: boolean }).__same)).toBe(true);
  await expect(page.getByText("notes.txt").first()).toBeVisible();
});

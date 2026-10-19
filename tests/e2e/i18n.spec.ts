import { expect, test } from "./guard.ts";

test("英文的工具頁：標題、lang 與介面都是英文", async ({ page }) => {
  await page.goto("./en/qrcode/");
  await expect(page).toHaveTitle("QR code generator | Gears");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Content for the QR code")).toBeVisible();
});

test("切換語系不重新載入，暫存區的檔案留著，上一頁回到原本的語系", async ({ page }) => {
  await page.goto("./en/");
  await expect(page.getByRole("heading", { name: "Gears" })).toBeVisible();
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("notes.txt").first()).toBeVisible();

  // 語系切換只放在頁尾
  await expect(page.locator(".site-header").getByRole("button", { name: "简体中文" })).toHaveCount(0);
  await page.locator("footer").getByRole("button", { name: "简体中文" }).click();
  await expect(page).toHaveURL(/\/gears\/zh-cn\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans");
  await expect(page.getByRole("heading", { name: "暂存区" })).toBeVisible();
  await expect(page.getByText("notes.txt").first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/gears\/en\/$/);
  await expect(page.getByRole("heading", { name: "Tray" })).toBeVisible();
  await expect(page.getByText("notes.txt").first()).toBeVisible();

});

test("在英文版打開工具，網址留在英文", async ({ page }) => {
  await page.goto("./en/");
  await page.getByRole("button", { name: /Passphrase and password generator/ }).first().click();
  await expect(page).toHaveURL(/\/gears\/en\/passphrase\/$/);
  await expect(page).toHaveTitle("Passphrase and password generator | Gears");
});

test.describe("瀏覽器的語言是英文", () => {
  test.use({ locale: "en-US" });

  test("正體中文的頁面建議換成英文，關掉之後站內換頁不再出現", async ({ page }) => {
    await page.goto("./");
    const hint = page.getByTestId("locale-hint");
    await expect(hint).toContainText("This page is available in English.");
    await hint.getByRole("button", { name: "Close" }).click();
    await expect(hint).toHaveCount(0);
    await page.getByRole("button", { name: /QR code 產生器/ }).first().click();
    await expect(page).toHaveURL(/\/gears\/qrcode\/$/);
    await expect(hint).toHaveCount(0);
  });

  test("按下切換，換成英文的同一頁", async ({ page }) => {
    await page.goto("./qrcode/");
    await page.getByTestId("locale-hint").getByRole("button", { name: "Switch to English" }).click();
    await expect(page).toHaveURL(/\/gears\/en\/qrcode\/$/);
    await expect(page.getByLabel("Content for the QR code")).toBeVisible();
    await expect(page.getByTestId("locale-hint")).toHaveCount(0);
  });

  test("英文的頁面不建議", async ({ page }) => {
    await page.goto("./en/");
    await expect(page.getByRole("heading", { name: "Gears" })).toBeVisible();
    await expect(page.getByTestId("locale-hint")).toHaveCount(0);
  });
});

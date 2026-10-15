import { expect, test } from "./guard.ts";

test("英文的工具頁：標題、lang 與介面都是英文", async ({ page }) => {
  await page.goto("./en/qrcode/");
  await expect(page).toHaveTitle("QR code generator | Privacy Workbench");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Content for the QR code")).toBeVisible();
});

test("切換語系不重新載入，暫存區的檔案留著，上一頁回到原本的語系", async ({ page }) => {
  await page.goto("./en/");
  await expect(page.getByRole("heading", { name: "Privacy Workbench" })).toBeVisible();
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("notes.txt").first()).toBeVisible();

  await page.getByRole("button", { name: "简体中文" }).click();
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
  await expect(page).toHaveTitle("Passphrase and password generator | Privacy Workbench");
});

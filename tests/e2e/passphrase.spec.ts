import { expect, test } from "./guard.ts";

test("密語預設 6 個字，可以重新產生，也可以換成隨機密碼", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /密語與密碼產生器/ }).click();
  await expect(page).toHaveURL(/\/gears\/passphrase\/$/);
  await expect(page).toHaveTitle("密語與密碼產生器 | 隱私工作台");

  const secret = page.getByTestId("secret");
  await expect(secret).toHaveText(/^[a-z]+( [a-z]+){5}$/);
  await expect(page.getByText("強度約 78 位元。")).toBeVisible();
  const first = await secret.textContent();
  await page.getByRole("button", { name: "重新產生" }).click();
  await expect(secret).not.toHaveText(first!);

  await page.getByLabel("-", { exact: true }).check();
  await expect(secret).toHaveText(/^[a-z]+(-[a-z]+){5}$/);

  await page.getByLabel("隨機密碼").check();
  await page.getByLabel("16 個字元").check();
  await expect(secret).toHaveText(/^\S{16}$/);
  for (const name of ["小寫字母", "大寫字母", "數字", "符號"]) await page.getByLabel(name).uncheck();
  await expect(secret).toHaveText("至少要勾選一種字元。");
  await expect(page.getByRole("button", { name: "複製" })).toBeDisabled();
  await page.getByLabel("數字").check();
  await expect(secret).toHaveText(/^\d{16}$/);
});

test("產生的密語不會出現在暫存區", async ({ page }) => {
  await page.goto("./passphrase/");
  await expect(page.getByTestId("secret")).toHaveText(/[a-z]/);
  await page.getByRole("button", { name: "回到桌面" }).click();
  await expect(page.locator(".tray .item")).toHaveCount(0);
});

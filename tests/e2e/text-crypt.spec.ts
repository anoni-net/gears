import { armor, Decrypter } from "age-encryption";
import { expect, test } from "./guard.ts";

test("用密語加密一段文字，用 age 解得開，再用工作台解回來", async ({ page }) => {
  await page.goto("./text-crypt/");
  const secret = "會面地點：台北車站東三門，暗號是藍色雨傘";
  await page.getByLabel("要加密的文字").fill(secret);
  await page.getByLabel("加密用的密語").fill("correct horse battery staple");
  await page.getByRole("button", { name: "加密", exact: true }).click();
  const cipher = await page.getByTestId("textcrypt-cipher").inputValue();
  expect(cipher).toMatch(/^-----BEGIN AGE ENCRYPTED FILE-----/);
  expect(cipher).not.toContain("台北");

  // 用 age 的官方實作解開，確認格式相容
  const d = new Decrypter();
  d.addPassphrase("correct horse battery staple");
  expect(await d.decrypt(armor.decode(cipher), "text")).toBe(secret);

  await page.getByLabel("解開加密的文字").check();
  await page.getByLabel("加密的文字", { exact: true }).fill(cipher);
  await page.getByLabel("密語或私鑰").fill("wrong passphrase");
  await page.getByRole("button", { name: "解開" }).click();
  await expect(page.getByText("解不開。請確認貼上的是完整的一段，密語或私鑰也要正確。")).toBeVisible();
  await page.getByLabel("密語或私鑰").fill("correct horse battery staple");
  await page.getByRole("button", { name: "解開" }).click();
  await expect(page.getByTestId("textcrypt-plain")).toHaveValue(secret);
});

test("短的加密文字可以做成 QR code", async ({ page }) => {
  await page.goto("./text-crypt/");
  await page.getByLabel("要加密的文字").fill("0912-345-678");
  await page.getByRole("button", { name: "產生一組密語" }).click();
  await page.getByRole("button", { name: "加密", exact: true }).click();
  await page.getByRole("button", { name: "做成 QR code" }).click();
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toBeVisible();
  await expect(page.getByLabel("要放進 QR code 的內容")).toHaveValue(/BEGIN AGE ENCRYPTED FILE/);
});

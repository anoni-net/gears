import { decrypt, encrypt } from "../../src/tools/age/index.ts";
import { downloadFrom, expect, test } from "./guard.ts";

test("產生金鑰組：私鑰預設遮住，下載的金鑰檔解得開用公鑰加密的檔案", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: /age 金鑰產生器/ }).click();
  await expect(page).toHaveURL(/\/gears\/age-keygen\/$/);
  await page.getByRole("button", { name: "產生一組金鑰" }).click();

  const recipient = (await page.getByTestId("recipient").textContent())!;
  expect(recipient).toMatch(/^age1[02-9ac-hj-np-z]{58}$/);
  await expect(page.getByTestId("identity")).toContainText("•");
  await page.getByRole("button", { name: "顯示私鑰" }).click();
  await expect(page.getByTestId("identity")).toHaveText(/^AGE-SECRET-KEY-1[0-9A-Z]+$/);

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "下載金鑰檔" }).click());
  expect(file.name).toBe("age-key.txt");
  const text = Buffer.from(file.data).toString("utf8");
  expect(text).toContain(`# public key: ${recipient}`);
  const secret = new TextEncoder().encode("只有私鑰解得開");
  const out = await encrypt(secret, { recipients: [recipient], armored: false });
  expect(await decrypt(out, text)).toEqual(secret);

  await page.getByRole("button", { name: "重新產生" }).click();
  await expect(page.getByTestId("recipient")).not.toHaveText(recipient);
});

test("公鑰做成 QR code，金鑰檔放進暫存區之後可以加密", async ({ page }) => {
  await page.goto("./age-keygen/");
  await page.getByRole("button", { name: "產生一組金鑰" }).click();
  const recipient = (await page.getByTestId("recipient").textContent())!;

  await page.getByRole("button", { name: "放進暫存區，用密語加密再存" }).click();
  await expect(page.getByRole("heading", { name: "age-key.txt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "開始加密" })).toBeVisible();

  await page.goto("./age-keygen/");
  await page.getByRole("button", { name: "產生一組金鑰" }).click();
  const second = (await page.getByTestId("recipient").textContent())!;
  expect(second).not.toBe(recipient);
  await page.getByRole("button", { name: "做成 QR code" }).click();
  await expect(page).toHaveURL(/\/gears\/qrcode\/$/);
  await expect(page.getByLabel("要放進 QR code 的內容")).toHaveValue(second);
  await expect(page.getByRole("img", { name: "QR code 預覽" })).toBeVisible();
});

test("從加密畫面連到金鑰產生器，暫存區不會被清空", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.getByRole("button", { name: "開始加密" }).click();
  await page.getByLabel("對方的公鑰").check();
  await page.getByRole("button", { name: /還沒有金鑰/ }).click();
  await expect(page).toHaveURL(/\/gears\/age-keygen\/$/);
  await expect(page.locator(".tray .item")).toContainText("notes.txt");
});

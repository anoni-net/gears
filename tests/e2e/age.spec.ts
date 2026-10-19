import { generateIdentity, identityToRecipient } from "age-encryption";
import { decrypt, encrypt, isArmored } from "../../src/tools/age/index.ts";
import { downloadFrom, expect, test } from "./guard.ts";

// scrypt 的預設工作因子在瀏覽器裡要一兩秒，加密之後還會解密一次確認
test.setTimeout(90_000);

const pdf = Buffer.from("%PDF-1.4\n內部簡報：第三季的數字\n%%EOF\n");

test("加密任何檔案：產生密語、加密、下載，再在工作台裡解開", async ({ page }) => {
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /只給對方看的檔案/ }).click()]);
  await chooser.setFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: pdf });

  await expect(page.getByRole("heading", { name: "加密", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "產生一組密語" }).click();
  const passphrase = await page.getByLabel("加密用的密語").inputValue();
  expect(passphrase.split(" ")).toHaveLength(6);
  await page.getByRole("button", { name: "加密", exact: true }).click();

  await expect(page.getByText("加密後", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("用密語加密（age，scrypt）")).toBeVisible();
  await expect(page.locator(".tray .item")).toContainText("已加密");
  const encrypted = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(encrypted.name).toBe("gears-1.pdf.age");
  // 給對方的說明：解密的網址，密語不在裡面
  const note = page.getByTestId("recipient-note").locator("blockquote");
  await expect(note).toContainText("/gears/decrypt/");
  await expect(note).toContainText("密語");
  expect(await note.textContent()).not.toContain(passphrase);
  expect(Buffer.from(await decrypt(encrypted.data, passphrase))).toEqual(pdf);

  await page.getByRole("button", { name: "開始解密" }).click();
  await page.getByLabel("密語或私鑰").fill(passphrase);
  await page.locator(".age").getByRole("button", { name: "解密" }).click();
  await expect(page.getByText("解密後", { exact: true })).toBeVisible({ timeout: 60_000 });
  const decrypted = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(decrypted.name).toBe("gears-1.pdf");
  expect(Buffer.from(decrypted.data)).toEqual(pdf);
});

test("加密給公鑰，輸出成文字格式", async ({ page }) => {
  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("這種檔案還沒有辦法檢查裡面的中繼資料")).toBeVisible();
  await page.getByRole("button", { name: "開始加密" }).click();
  await page.getByLabel("對方的公鑰").check();
  await page.getByLabel("對方的 age 公鑰，一行一把").fill("ssh-rsa AAAA");
  await expect(page.getByText("格式不對，age 公鑰是 age1 開頭：ssh-rsa AAAA")).toBeVisible();
  await expect(page.getByRole("button", { name: "加密", exact: true })).toBeDisabled();
  await page.getByLabel("對方的 age 公鑰，一行一把").fill(recipient);
  await page.getByLabel("輸出成文字，方便貼進電子郵件或訊息").check();
  await page.getByRole("button", { name: "加密", exact: true }).click();
  await expect(page.getByText("加密給公鑰（age）")).toBeVisible();

  const out = await downloadFrom(page, () => page.getByRole("link", { name: "下載" }).click());
  expect(out.name).toBe("gears-1.txt.age");
  expect(isArmored(out.data)).toBe(true);
  await expect(page.getByTestId("recipient-note")).toContainText("AGE-SECRET-KEY-");
  expect(new TextDecoder().decode(await decrypt(out.data, identity))).toBe("hello");
});

test("密語太短不能加密，密語錯了解不開", async ({ page }) => {
  const encrypted = await encrypt(new TextEncoder().encode("secret"), { passphrase: "right passphrase", armored: false, scryptLogN: 10 });
  await page.goto("./");
  await page.getByTestId("file-input").setInputFiles({ name: "secret.age", mimeType: "application/octet-stream", buffer: Buffer.from(encrypted) });
  await expect(page.locator(".tray .item")).toContainText("已加密");
  await page.getByRole("button", { name: "開始解密" }).click();
  await page.getByLabel("密語或私鑰").fill("wrong passphrase");
  await page.locator(".age").getByRole("button", { name: "解密" }).click();
  await expect(page.getByRole("alert")).toContainText("解不開");

  await page.getByLabel("密語或私鑰").fill("right passphrase");
  await page.locator(".age").getByRole("button", { name: "解密" }).click();
  await expect(page.getByText("解密成功")).toBeVisible();

  await page.getByRole("button", { name: "開始加密" }).click();
  await page.getByLabel("加密用的密語").fill("short");
  await expect(page.getByText("密語至少要 8 個字元")).toBeVisible();
  await expect(page.getByRole("button", { name: "加密", exact: true })).toBeDisabled();
});

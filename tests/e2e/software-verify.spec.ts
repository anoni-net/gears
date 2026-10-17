import { readFileSync } from "node:fs";
import { expect, test } from "./guard.ts";

// 用 Tor Browser 15.0.25 官方的 sha256sums-signed-build.txt 與簽章（tests/helpers/signed/）
const dir = new URL("../helpers/signed/", import.meta.url);
const NAME = "tor-browser-15.0.25-sha256sums.txt";
const FILE = readFileSync(new URL(NAME, dir));
const SIG = readFileSync(new URL(`${NAME}.asc`, dir));

test("一次選兩個檔案：自動分出簽章檔，驗證通過，列出簽署的子金鑰與 SHA-256", async ({ page }) => {
  await page.goto("./software-verify/");
  await page.getByTestId("software-file").setInputFiles([
    { name: `${NAME}.asc`, mimeType: "application/pgp-signature", buffer: SIG },
    { name: NAME, mimeType: "text/plain", buffer: FILE },
  ]);
  const verdict = page.getByTestId("software-verdict");
  await expect(verdict).toContainText("簽章正確");
  await expect(verdict).toContainText("這個檔案由 Tor Browser 開發者的金鑰簽署");
  await expect(verdict).toContainText("022D A248 432D 2A0E 0F54 E65E 316C 1FAC D62D 07D9");
  await expect(page.locator("code.hash")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("software-mismatch")).toHaveCount(0);
  await expect(page.getByText("EF6E 286D DA85 EA2A 4BA7 DE68 4E2C 6E87 9329 8290")).toBeVisible();
});

test("檔案被改過：說明不要安裝", async ({ page }) => {
  await page.goto("./software-verify/");
  const bad = Buffer.from(FILE);
  bad[100]! ^= 1;
  await page.getByTestId("software-file").setInputFiles({ name: NAME, mimeType: "text/plain", buffer: bad });
  await page.getByTestId("software-signature").setInputFiles({ name: `${NAME}.asc`, mimeType: "application/pgp-signature", buffer: SIG });
  await expect(page.getByTestId("software-verdict")).toContainText("檔案跟簽章對不上");
  await expect(page.getByTestId("software-verdict")).toContainText("不要安裝");
});

test("選錯簽章檔：名稱對不上的提醒，讀不出簽章", async ({ page }) => {
  await page.goto("./software-verify/");
  await page.getByTestId("software-file").setInputFiles({ name: "installer.exe", mimeType: "application/octet-stream", buffer: FILE });
  await page.getByTestId("software-signature").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByTestId("software-mismatch")).toBeVisible();
  await expect(page.getByTestId("software-verdict")).toContainText("讀不出簽章");
});

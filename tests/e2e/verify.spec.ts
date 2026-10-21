import { createHash } from "node:crypto";
import { bytes, insertIntoJpeg, segment, syntheticJpeg } from "../helpers/fixtures.ts";
import { incrementalPdf } from "../helpers/pdf-incremental.ts";
import { proofModeBundle } from "../helpers/proofmode.ts";
import { makeCert, signedPdf } from "../helpers/signed-pdf.ts";
import { c2paFixture, hasC2paFixtures } from "../helpers/c2pa-fixtures.ts";
import { readFileSync } from "node:fs";
import { downloadFrom, expect, test } from "./guard.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

test("從任務選照片與 PDF：雜湊值、時間線、裝置、人名、位置、PDF 的舊版本與查證紀錄", async ({ page }) => {
  const photo = Buffer.from(syntheticJpeg());
  const { bytes, firstEnd } = await incrementalPdf();
  const pdf = Buffer.from(bytes);
  await page.goto("./");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /收到的照片與文件/ }).click()]);
  await chooser.setFiles([
    { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "report.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);

  // 加入檔案之後留在查證的畫面
  await expect(page.getByRole("heading", { name: "查證檔案" })).toBeVisible();
  const cards = page.locator(".verify-card");
  await expect(cards.getByRole("heading", { name: "photo.jpg" })).toBeVisible();
  await expect(cards.getByRole("heading", { name: "report.pdf" })).toBeVisible();
  // 查證要保留中繼資料，暫存區不放一次清除的按鈕，壓縮檔照樣可以下載
  await expect(page.getByTestId("batch").getByRole("button", { name: "全部下載成一個壓縮檔" })).toBeVisible();
  await expect(page.getByTestId("batch").getByRole("button", { name: /清除/ })).toHaveCount(0);
  // 雜湊值收在完整資訊裡
  await expect(page.getByTestId("verify-hash")).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByTestId("verify-hash").first()).toHaveText(sha256(photo));
  await expect(page.getByTestId("verify-hash").nth(1)).toHaveText(sha256(pdf));
  await expect(page.getByTestId("verify-hash").first()).toBeHidden();
  await cards.first().getByText("完整資訊（雜湊值與所有時間）").click();
  await expect(page.getByTestId("verify-hash").first()).toBeVisible();

  // 總覽與需要留意的地方：用檔名稱呼，寫出可能的原因
  await expect(page.getByText("2 個檔案，有 1 個地方需要留意。")).toBeVisible();
  const warnings = page.locator(".verify-warnings");
  await expect(warnings.getByText("存著較早的版本")).toBeVisible();
  await expect(warnings.getByText("report.pdf 裡存了 2 個版本，修改時舊的內容留在檔案裡。可以在檔案的版本紀錄裡比對各版本改了什麼。")).toBeVisible();
  await expect(cards.nth(1).getByText("需要留意：存著較早的版本")).toBeVisible();

  // 每個檔案的重點
  const photoCard = cards.first();
  await expect(photoCard.getByText("照片 · JPG")).toBeVisible();
  await expect(photoCard.getByText("2026-10-14 09:30:00（沒有時區）").first()).toBeVisible();
  await expect(photoCard.getByText("TestMaker SECRET-MODEL")).toBeVisible();
  await expect(photoCard.getByText("相機設定的擁有者 Jane Doe")).toBeVisible();
  await expect(photoCard.getByText("25.03300, 121.56540")).toBeVisible();
  const pdfCard = cards.nth(1);
  await expect(pdfCard.getByText("2024-06-01 02:00:00（UTC+00:00）").first()).toBeVisible();
  await expect(pdfCard.getByText("作者 Reporter A")).toBeVisible();

  // 兩個以上的檔案才有關聯與合併的時間線，時間線預設收起來
  await expect(page.getByRole("heading", { name: "檔案之間的關聯" })).toBeVisible();
  await expect(page.getByText("這些檔案之間沒有共同的裝置、軟體或人名。")).toBeVisible();
  await expect(page.locator(".verify-timeline")).toBeHidden();

  // 版本紀錄：列在原檔的卡片裡，不放進暫存區
  await expect(pdfCard.getByText("這份 PDF 存了 2 個版本。")).toBeVisible();
  await expect(pdfCard.getByText("第 2 版（目前的版本）")).toBeVisible();
  const old = await downloadFrom(page, () => pdfCard.getByRole("button", { name: "下載第 1 版" }).click());
  expect(old.name).toBe("report-v1.pdf");
  expect(Buffer.from(old.data).equals(pdf.subarray(0, firstEnd))).toBe(true);

  // 比對：中繼資料、文字與畫面
  await pdfCard.getByRole("button", { name: "跟第 2 版比對" }).click();
  const compare = page.getByTestId("verify-compare");
  await expect(compare.getByText("第 1 版與第 2 版的差異")).toBeVisible();
  await expect(compare.getByText("修改時間：沒有 → 2024-06-02 02:00:00（UTC+00:00）")).toBeVisible();
  await expect(compare.getByText("第 1 頁：有變動")).toBeVisible({ timeout: 15000 });
  await expect(compare.locator(".verify-text-diff .removed")).toHaveText(["刪掉的文字：− Amount 100"]);
  await expect(compare.locator(".verify-text-diff .added")).toHaveText(["加入的文字：+ Amount 900"]);
  await expect(compare.getByRole("img")).toHaveCount(2);
  await expect(compare.getByText("其他 1 頁沒有找到差異。")).toBeVisible();
  await expect(cards).toHaveCount(2);

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "下載查證紀錄" }).click());
  expect(file.name).toMatch(/^gears-verify-\d{12}\.md$/);
  const report = Buffer.from(file.data).toString("utf8");
  expect(report).toContain("# 查證紀錄");
  expect(report).toContain("2 個檔案，有 1 個地方需要留意。");
  expect(report).toContain("- **存著較早的版本**：report.pdf 裡存了 2 個版本");
  expect(report).toContain(`SHA-256：\`${sha256(photo)}\``);
  expect(report).toContain(`SHA-256：\`${sha256(pdf)}\``);
  expect(report).toContain("- 位置：25.03300, 121.56540");

  // 放進暫存區的查證紀錄不算進這一批
  await page.getByRole("button", { name: "放進暫存區" }).click();
  await expect(page.getByText(/gears-verify-\d{12}\.md/).first()).toBeVisible();
  await expect(cards).toHaveCount(2);
});

test("暫存區沒有檔案時，只顯示說明與選擇檔案", async ({ page }) => {
  await page.goto("./verify/");
  await expect(page.getByText(/有矛盾不代表造假/)).toBeVisible();
  await expect(page.getByRole("button", { name: "選擇檔案" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "時間線" })).toHaveCount(0);
});

test("來源標示：IPTC 的 AI 欄位與 GB 45438 的隱式標識列在卡片上，完整的提示詞收在完整資訊", async ({ page }) => {
  // 編出來的服務提供者編碼：個人、綁手機號碼，號碼照實列出
  const producer = `0022${"19900001111"}${"0".repeat(7)}00000`;
  const aigc = JSON.stringify({ Label: "1", ContentProducer: producer, ProduceID: "pid-e2e-1" }).replaceAll('"', "&quot;");
  const prompt = `a lighthouse at dusk, ${"oil painting, ".repeat(12)}soft light`;
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:TC260="http://www.tc260.org.cn/ns/AIGC/1.0/"' +
    ` Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" Iptc4xmpExt:AISystemUsed="Example Image Model" TC260:AIGC="${aigc}">` +
    `<Iptc4xmpExt:AIPromptInformation>${prompt}</Iptc4xmpExt:AIPromptInformation></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const photo = Buffer.from(insertIntoJpeg(syntheticJpeg(), segment(0xe1, bytes(`http://ns.adobe.com/xap/1.0/\0${xmp}`))));
  await page.goto("./verify/");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選擇檔案" }).first().click()]);
  await chooser.setFiles([{ name: "generated.jpg", mimeType: "image/jpeg", buffer: photo }]);

  const card = page.locator(".verify-card").first();
  await expect(card.getByText("來源標示")).toBeVisible({ timeout: 15000 });
  await expect(card.getByText("IPTC 的數位來源類型：用生成式 AI 產生（trainedAlgorithmicMedia）")).toBeVisible();
  await expect(card.getByText("IPTC 記錄的 AI 系統：Example Image Model")).toBeVisible();
  await expect(card.getByText("GB 45438 的隱式標識（XMP）：標示為 AI 生成合成的內容")).toBeVisible();
  await expect(card.getByText(`生成服務：個人，手機號碼 19900001111（${producer}）`)).toBeVisible();
  await expect(card.getByText(/除了 C2PA 內容憑證，這些標示都沒有簽章/)).toBeVisible();
  // 卡片上只列提示詞的開頭，完整的收在完整資訊
  await expect(card.getByText(`IPTC 記錄的提示詞：${prompt.slice(0, 120)}…`)).toBeVisible();
  await card.getByText("完整資訊（雜湊值與所有時間）").click();
  await expect(card.locator(".verify-prompt")).toHaveText(prompt);

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "下載查證紀錄" }).click());
  const report = Buffer.from(file.data).toString("utf8");
  expect(report).toContain("- 來源標示：");
  expect(report).toContain(`    - IPTC 記錄的提示詞：${prompt}`);
  expect(report).toContain(`    - 生成服務：個人，手機號碼 19900001111（${producer}）`);
  expect(report).toContain("沒有 AI 生成的標示也不代表不是 AI 產生的");
});

test("ProofMode 的證明檔：簽章、公鑰指紋與感測器資料，照片可以一起查證", async ({ page }) => {
  const { zip, fingerprint } = await proofModeBundle();
  await page.goto("./verify/");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選擇檔案" }).first().click()]);
  await chooser.setFiles([{ name: "IMG_0001-proofmode.zip", mimeType: "application/zip", buffer: Buffer.from(zip) }]);

  const block = page.getByTestId("verify-proofmode");
  await expect(block.getByText("ProofMode 的證明檔，1 份證明")).toBeVisible({ timeout: 15000 });
  await expect(block.getByText(fingerprint.replace(/(.{4})(?!$)/g, "$1 "))).toBeVisible();
  await expect(block.getByText("照片或影片：IMG_0001.jpg")).toBeVisible();
  await expect(block.getByText(/^照片的簽章正確/)).toBeVisible();
  await expect(block.getByText(/^感測器資料的簽章正確/)).toBeVisible();
  await expect(block.getByText(/OpenTimestamps/)).toBeVisible();
  // 感測器資料完整列出，收在可以展開的區塊
  await block.getByText("感測器資料（8 項）").click();
  await expect(block.getByText("02:00:00:00:00:00")).toBeVisible();
  // 位置併進檔案卡片
  await expect(page.locator(".verify-card").first().getByText("25.03300, 121.56540")).toBeVisible();

  await block.getByRole("button", { name: "照片一起查證" }).click();
  await expect(block.getByRole("button", { name: "已加入這一批" })).toBeDisabled();
  await expect(page.locator(".verify-card")).toHaveCount(2);
  await expect(page.locator(".verify-card").getByRole("heading", { name: "IMG_0001.jpg" })).toBeVisible();

  const file = await downloadFrom(page, () => page.getByRole("button", { name: "下載查證紀錄" }).click());
  const report = Buffer.from(file.data).toString("utf8");
  expect(report).toContain("- ProofMode 的證明檔，1 份證明");
  expect(report).toContain("        - Wifi MAC：02:00:00:00:00:00");
});

test("C2PA 內容憑證：用 c2pa-web 驗證，列出信任清單、撤銷狀態與動作，內容被改過的列在需要留意的地方", async ({ page }) => {
  test.skip(!hasC2paFixtures(), "沒有 C2PA 的測試圖");
  await page.goto("./verify/");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選擇檔案" }).first().click()]);
  await chooser.setFiles([
    { name: "photoshop.jpg", mimeType: "image/jpeg", buffer: readFileSync(c2paFixture("ocsp.jpg")) },
    { name: "changed.jpg", mimeType: "image/jpeg", buffer: readFileSync(c2paFixture("XCA.jpg")) },
  ]);
  const cards = page.locator(".verify-card");
  const signed = cards.filter({ has: page.getByRole("heading", { name: "photoshop.jpg" }) });
  await expect(signed.getByText("C2PA 內容憑證：簽章有效，簽署者在 C2PA 的過渡信任清單裡（2026 年起不再新增簽署者）")).toBeVisible({ timeout: 30000 });
  await expect(signed.getByText("簽署者：Adobe C2PA（Adobe Inc.）")).toBeVisible();
  await expect(signed.getByText("檔案內附的撤銷資料顯示憑證沒有被撤銷")).toBeVisible();
  await expect(signed.getByText(/^動作紀錄：開啟既有的檔案（用生成式 AI 編修過（compositeWithTrainedAlgorithmicMedia））/)).toBeVisible();

  const changed = cards.filter({ has: page.getByRole("heading", { name: "changed.jpg" }) });
  await expect(changed.getByText("C2PA 內容憑證：驗證沒有通過")).toBeVisible({ timeout: 30000 });
  await expect(changed.getByText("內容在簽署之後被改過", { exact: true })).toBeVisible();
  await expect(page.locator(".verify-warnings").getByText("內容在簽署之後被改過")).toBeVisible();
});

test("C2PA 內容憑證：身分聲明的帳號與 AI 訓練的標示，影片也驗證", async ({ page }) => {
  test.skip(!hasC2paFixtures(), "沒有 C2PA 的測試圖");
  await page.goto("./verify/");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選擇檔案" }).first().click()]);
  await chooser.setFiles([
    { name: "identity.jpg", mimeType: "image/jpeg", buffer: readFileSync(c2paFixture("adobe_connected_identities.jpg")) },
    { name: "training.jpg", mimeType: "image/jpeg", buffer: readFileSync(c2paFixture("C_with_CAWG_data.jpg")) },
    { name: "clip.mp4", mimeType: "video/mp4", buffer: readFileSync(c2paFixture("video1.mp4")) },
  ]);
  const card = (name: string) => page.locator(".verify-card").filter({ has: page.getByRole("heading", { name }) });
  const identity = card("identity.jpg");
  await expect(identity.getByText("身分聲明：由 did:web:connected-identities.identity-stage.adobe.com 簽發，列出創作者驗證過的帳號")).toBeVisible({ timeout: 30000 });
  await expect(identity.getByText(/^社群帳號：behance testuser23 <https:\/\/net\.s2stagehance\.com\/testuser23>，驗證時間 2025-04-09 22:45:26/)).toBeVisible();
  // 驗證簽發者要連線取得 did:web 的金鑰，頁面的 CSP 擋下，內容憑證本身照樣有效
  await expect(identity.getByText("身分聲明的簽發者要連線才能確認，這裡不連線，列出的帳號沒有經過驗證")).toBeVisible();
  await expect(identity.getByText("C2PA 內容憑證：驗證沒有通過")).toHaveCount(0);
  await expect(card("training.jpg").getByText("創作者對 AI 使用的標示：不允許用於 AI 推論、不允許用於生成式 AI 訓練")).toBeVisible({ timeout: 30000 });
  await expect(card("clip.mp4").getByText("C2PA 內容憑證：簽章有效，但簽署者不在信任清單裡，無法確認是誰簽的")).toBeVisible({ timeout: 30000 });
});

test("PDF 數位簽章：驗證簽章與憑證鏈，簽完之後被改過的列在需要留意的地方", async ({ page }) => {
  const day = 86_400_000;
  const root = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(Date.now() - 3650 * day), to: new Date(Date.now() + 3650 * day) });
  const leaf = await makeCert({ cn: "測試簽署人", issuer: root, serial: 2, from: new Date(Date.now() - day), to: new Date(Date.now() + 365 * day) });
  await page.goto("./verify/");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選擇檔案" }).first().click()]);
  await chooser.setFiles([
    { name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from(await signedPdf(leaf)) },
    { name: "tampered.pdf", mimeType: "application/pdf", buffer: Buffer.from(await signedPdf(leaf, { tamper: true })) },
  ]);
  const card = (name: string) => page.locator(".verify-card").filter({ has: page.getByRole("heading", { name }) });
  const signed = card("signed.pdf");
  await expect(signed.getByText("簽章正確，簽完之後涵蓋的範圍沒有被改過")).toBeVisible({ timeout: 30000 });
  await expect(signed.getByText(/^簽署者的憑證：.*CN=測試簽署人/)).toBeVisible();
  // 測試的根憑證不在內建的清單裡
  await expect(signed.getByText(/^憑證鏈接不到內建的信任清單/)).toBeVisible();

  const tampered = card("tampered.pdf");
  await expect(tampered.getByText("簽署的範圍在簽完之後被改過")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".verify-warnings").getByText("數位簽章驗證沒有通過")).toBeVisible();
});


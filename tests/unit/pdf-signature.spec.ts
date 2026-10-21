import { expect, test } from "@playwright/test";
import { examine } from "../../src/tools/verify/examine.ts";
import { readFileSync } from "node:fs";
import * as pkijs from "pkijs";
import { pemToDer, verifyPdfSignature } from "../../src/tools/verify/pdf-signature.ts";
import { makeCert, signedPdf } from "../helpers/signed-pdf.ts";

const day = 86_400_000;
const now = Date.now();

async function setup(leafTo = new Date(now + 365 * day)) {
  const root = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const leaf = await makeCert({ cn: "測試簽署人", org: "Gears Test Signers", issuer: root, serial: 2, from: new Date(now - 730 * day), to: leafTo });
  return { root, leaf };
}

async function check(pdf: Uint8Array, roots: Uint8Array[]) {
  const ev = await examine(pdf, "pdf");
  const sig = ev.signatures[0]!;
  expect(sig.subFilter).toBe("adbe.pkcs7.detached");
  return verifyPdfSignature(pdf, { byteRange: sig.byteRange!, contents: sig.contents! }, { roots, intermediates: [] });
}

test("簽章正確、憑證鏈接到內建的根憑證", async () => {
  const { root, leaf } = await setup();
  const result = await check(await signedPdf(leaf), [root.der]);
  expect(result).toMatchObject({ integrity: "intact", signature: "valid", chain: "trusted" });
  // 測試用的憑證把主體的三個屬性放在同一組裡，DER 會重新排序，所以只比對內容
  expect(result.root).toContain("CN=Gears Test Root");
  expect(result.signer).toContain("CN=測試簽署人");
  expect(result.signer).toContain("O=Gears Test Signers");
  expect(result.issuer).toContain("CN=Gears Test Root");
  expect(result.signingTime).toBeTruthy();
});

test("根憑證不在內建的清單裡：簽章正確，簽署者不受信任", async () => {
  const { leaf } = await setup();
  expect(await check(await signedPdf(leaf), [])).toMatchObject({ integrity: "intact", signature: "valid", chain: "untrusted" });
});

// 自己做的根憑證不能因為內建的信任清單裡有很多張中繼憑證，就被當成接到 GRCA。pkijs 的引擎把
// 清單的最後一張當成要驗證的憑證，簽署者重複放進去時驗到的會是某張中繼憑證（2026-10-21 發現）
test("自己做的根憑證簽的，搭配完整的 GRCA 信任清單，仍然不受信任", async () => {
  const { leaf } = await setup();
  const pdf = await signedPdf(leaf);
  const sig = (await examine(pdf, "pdf")).signatures[0]!;
  const trust = { roots: pemToDer(readFileSync("src/tools/verify/pdf-trust/grca-roots.pem", "utf8")), intermediates: pemToDer(readFileSync("src/tools/verify/pdf-trust/gpki-cas.pem", "utf8")) };
  const result = await verifyPdfSignature(pdf, { byteRange: sig.byteRange!, contents: sig.contents! }, trust);
  expect(result).toMatchObject({ signature: "valid", chain: "untrusted" });
  expect(result.root).toBeUndefined();
});

test("簽署者由中繼憑證簽發，中繼憑證在內建的清單裡：接到根憑證", async () => {
  const root = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const mid = await makeCert({ cn: "Gears Test CA", ca: true, issuer: root, serial: 3, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const leaf = await makeCert({ cn: "測試簽署人", issuer: mid, serial: 4, from: new Date(now - day), to: new Date(now + 365 * day) });
  const pdf = await signedPdf(leaf);
  const sig = (await examine(pdf, "pdf")).signatures[0]!;
  const result = await verifyPdfSignature(pdf, { byteRange: sig.byteRange!, contents: sig.contents! }, { roots: [root.der], intermediates: [mid.der] });
  expect(result.chain).toBe("trusted");
  expect(result.root).toContain("CN=Gears Test Root");
  // 少了中繼憑證就接不到
  expect((await verifyPdfSignature(pdf, { byteRange: sig.byteRange!, contents: sig.contents! }, { roots: [root.der], intermediates: [] })).chain).toBe("untrusted");
});

test("簽完之後內容被改過", async () => {
  const { root, leaf } = await setup();
  expect(await check(await signedPdf(leaf, { tamper: true }), [root.der])).toMatchObject({ integrity: "changed", signature: "invalid", chain: "not-checked" });
});

test("簽署者的憑證已經過期，簽章裡寫的簽署時間還在效期內", async () => {
  const { root, leaf } = await setup(new Date(now - 30 * day));
  const result = await check(await signedPdf(leaf, { signedAt: new Date(now - 60 * day) }), [root.der]);
  expect(result).toMatchObject({ signature: "valid", chain: "trusted-at-signing" });
});

test("內建的 GRCA 根憑證與下屬憑證機構：pkijs 讀得出來，效期內的都接得到根憑證", async () => {
  const roots = pemToDer(readFileSync("src/tools/verify/pdf-trust/grca-roots.pem", "utf8")).map((d) => pkijs.Certificate.fromBER(d.slice().buffer));
  const cas = pemToDer(readFileSync("src/tools/verify/pdf-trust/gpki-cas.pem", "utf8")).map((d) => pkijs.Certificate.fromBER(d.slice().buffer));
  expect(roots).toHaveLength(3);
  expect(cas).toHaveLength(12);
  for (const ca of cas) {
    // 已經過期的（第一代）用效期內的時間驗
    const date = ca.notAfter.value < new Date() ? new Date(ca.notAfter.value.getTime() - 86_400_000) : new Date();
    const result = await new pkijs.CertificateChainValidationEngine({ certs: [ca], trustedCerts: roots, checkDate: date }).verify({ passedWhenNotRevValues: true });
    expect(result.result, result.resultMessage).toBe(true);
  }
});


import { expect, test } from "@playwright/test";
import { examine } from "../../src/tools/verify/examine.ts";
import { readFileSync } from "node:fs";
import * as pkijs from "pkijs";
import { pemToDer, verifyPdfSignature } from "../../src/tools/verify/pdf-signature.ts";
import { type TestCert, makeCert, signedPdf } from "../helpers/signed-pdf.ts";
import type { TrustStore } from "../../src/tools/verify/pdf-signature.ts";

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

async function tsaSetup() {
  const tsaRoot = await makeCert({ cn: "Gears Test TSA Root", ca: true, serial: 11, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const tsa = await makeCert({ cn: "Gears Test TSA", issuer: tsaRoot, serial: 12, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  return { tsaRoot, tsa };
}

async function verify(pdf: Uint8Array, trust: TrustStore) {
  const sig = (await examine(pdf, "pdf")).signatures[0]!;
  return verifyPdfSignature(pdf, { byteRange: sig.byteRange!, contents: sig.contents! }, trust);
}

test("附在簽章上的時間戳記：時間戳記服務接到內建的根憑證", async () => {
  const { root, leaf } = await setup();
  const { tsaRoot, tsa } = await tsaSetup();
  const at = new Date(now - day);
  const result = await verify(await signedPdf(leaf, { timestamp: { tsa, at } }), { roots: [root.der, tsaRoot.der], intermediates: [] });
  expect(result).toMatchObject({ kind: "signature", signature: "valid", chain: "trusted" });
  expect(result.timestamp).toMatchObject({ imprint: "match", signature: "valid", chain: "trusted", time: at.toISOString() });
  expect(result.timestamp!.tsa).toContain("CN=Gears Test TSA");
  expect(result.timestamp!.root).toContain("CN=Gears Test TSA Root");
});

test("時間戳記服務的根憑證只在時間戳記服務的清單裡：照樣採信", async () => {
  const { root, leaf } = await setup();
  const { tsaRoot, tsa } = await tsaSetup();
  const pdf = await signedPdf(leaf, { timestamp: { tsa, at: new Date(now - day) } });
  expect((await verify(pdf, { roots: [root.der], intermediates: [], tsaRoots: [tsaRoot.der] })).timestamp!.chain).toBe("trusted");
  // 簽署者的憑證鏈不採用時間戳記服務的清單
  expect((await verify(await signedPdf(tsa), { roots: [], intermediates: [], tsaRoots: [tsaRoot.der] })).chain).toBe("untrusted");
});

test("簽署者的憑證已經過期，時間戳記證明的時間在效期內", async () => {
  const { root, leaf } = await setup(new Date(now - 30 * day));
  const { tsaRoot, tsa } = await tsaSetup();
  // 簽署端自己填的時間在過期之後，只有時間戳記能證明是過期之前簽的
  const pdf = await signedPdf(leaf, { signedAt: new Date(now), timestamp: { tsa, at: new Date(now - 60 * day) } });
  const result = await verify(pdf, { roots: [root.der, tsaRoot.der], intermediates: [] });
  expect(result).toMatchObject({ signature: "valid", chain: "trusted-at-timestamp" });
  expect(result.root).toContain("CN=Gears Test Root");
});

test("時間戳記服務不受信任：不採用它的時間，退回簽章裡寫的時間", async () => {
  const { root, leaf } = await setup(new Date(now - 30 * day));
  const { tsa } = await tsaSetup();
  const pdf = await signedPdf(leaf, { signedAt: new Date(now - 60 * day), timestamp: { tsa, at: new Date(now - 60 * day) } });
  const result = await verify(pdf, { roots: [root.der], intermediates: [] });
  expect(result.timestamp).toMatchObject({ imprint: "match", signature: "valid", chain: "untrusted" });
  expect(result.timestamp!.root).toBeUndefined();
  expect(result.chain).toBe("trusted-at-signing");
});

test("時間戳記的雜湊值跟簽章值對不上", async () => {
  const { root, leaf } = await setup(new Date(now - 30 * day));
  const { tsaRoot, tsa } = await tsaSetup();
  const pdf = await signedPdf(leaf, { signedAt: new Date(now), timestamp: { tsa, at: new Date(now - 60 * day), wrong: true } });
  const result = await verify(pdf, { roots: [root.der, tsaRoot.der], intermediates: [] });
  expect(result.timestamp).toMatchObject({ imprint: "mismatch", chain: "untrusted" });
  expect(result.chain).toBe("untrusted");
});

async function documentTimestamp(tsa: TestCert, tamper = false) {
  const pdf = await signedPdf(tsa, { document: true, tamper, timestamp: { tsa, at: new Date(now - day) } });
  expect((await examine(pdf, "pdf")).signatures[0]!.subFilter).toBe("ETSI.RFC3161");
  return pdf;
}

test("整份文件的時間戳記", async () => {
  const { tsaRoot, tsa } = await tsaSetup();
  const result = await verify(await documentTimestamp(tsa), { roots: [], intermediates: [], tsaRoots: [tsaRoot.der] });
  expect(result).toMatchObject({ kind: "document", integrity: "intact", signature: "valid", chain: "trusted" });
  expect(result.signer).toContain("CN=Gears Test TSA");
  expect(result.timestamp!.time).toBe(new Date(now - day).toISOString());
  expect((await verify(await documentTimestamp(tsa), { roots: [], intermediates: [] })).chain).toBe("untrusted");
});

test("整份文件的時間戳記：蓋完之後內容被改過", async () => {
  const { tsaRoot, tsa } = await tsaSetup();
  const result = await verify(await documentTimestamp(tsa, true), { roots: [], intermediates: [], tsaRoots: [tsaRoot.der] });
  expect(result).toMatchObject({ kind: "document", integrity: "changed", signature: "invalid" });
  expect(result.timestamp!.imprint).toBe("mismatch");
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


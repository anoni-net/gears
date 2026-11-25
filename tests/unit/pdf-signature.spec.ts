import { expect, test } from "@playwright/test";
import { examine } from "../../src/tools/verify/examine.ts";
import { readFileSync } from "node:fs";
import * as pkijs from "pkijs";
import { gapIsContents, pemToDer, verifyPdfSignature } from "../../src/tools/verify/pdf-signature.ts";
import { type TestCert, crl, makeCert, ocspResponse, signedPdf } from "../helpers/signed-pdf.ts";
import type { PdfSignatureCheck, TrustStore } from "../../src/tools/verify/pdf-signature.ts";

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

async function verifyWithDss(pdf: Uint8Array, trust: TrustStore) {
  const ev = await examine(pdf, "pdf");
  const sig = ev.signatures[0]!;
  return verifyPdfSignature(pdf, { byteRange: sig.byteRange!, contents: sig.contents!, dss: ev.dss }, trust);
}

test("撤銷狀態：簽章裡附的 OCSP 回應，由簽發者簽的", async () => {
  const { root, leaf } = await setup();
  const at = new Date(now - day);
  const pdf = await signedPdf(leaf, { revocation: { where: "cms", ocsps: [await ocspResponse(leaf, root, { status: "good", at })] } });
  const result = await verify(pdf, { roots: [root.der], intermediates: [] });
  expect(result.revocation).toEqual({ status: "good", source: "ocsp", checkedAt: at.toISOString() });
});

test("撤銷狀態：/DSS 裡的 OCSP 回應由授權的回應者簽，憑證已被撤銷", async () => {
  const { root, leaf } = await setup();
  const responder = await makeCert({ cn: "Gears Test OCSP", issuer: root, serial: 21, from: new Date(now - 2 * day), to: new Date(now - day / 2), eku: ["1.3.6.1.5.5.7.3.9"] });
  const revokedAt = new Date(now - 3 * day);
  const at = new Date(now - day);
  // 回應者的憑證現在已經過期，回應產生時還在效期內
  const pdf = await signedPdf(leaf, { revocation: { where: "dss", ocsps: [await ocspResponse(leaf, root, { status: "revoked", at, revokedAt, responder })] } });
  const ev = await examine(pdf, "pdf");
  expect(ev.dss?.ocsps).toHaveLength(1);
  const result = await verifyWithDss(pdf, { roots: [root.der], intermediates: [] });
  expect(result.revocation).toMatchObject({ status: "revoked", source: "ocsp", revokedAt: revokedAt.toISOString() });
  expect(result.revocation!.afterTimestamp).toBeUndefined();
});

test("撤銷狀態：沒有 OCSP 簽署用途的回應者、別人簽的回應都不採信", async () => {
  const { root, leaf } = await setup();
  const at = new Date(now - day);
  const noEku = await makeCert({ cn: "Gears Test Not OCSP", issuer: root, serial: 22, from: new Date(now - 2 * day), to: new Date(now + day) });
  const otherRoot = await makeCert({ cn: "Other Root", ca: true, serial: 23, from: new Date(now - 2 * day), to: new Date(now + day) });
  const stranger = await makeCert({ cn: "Gears Test OCSP", issuer: otherRoot, serial: 24, from: new Date(now - 2 * day), to: new Date(now + day), eku: ["1.3.6.1.5.5.7.3.9"] });
  for (const responder of [noEku, stranger]) {
    const pdf = await signedPdf(leaf, { revocation: { where: "cms", ocsps: [await ocspResponse(leaf, root, { status: "revoked", at, responder })] } });
    expect((await verify(pdf, { roots: [root.der], intermediates: [] })).revocation).toEqual({ status: "unverified", source: "ocsp" });
  }
});

test("撤銷狀態：/DSS 裡的撤銷清單", async () => {
  const { root, leaf } = await setup();
  const at = new Date(now - day);
  // 撤銷清單的時間用 UTCTime，只到秒
  const revokedAt = new Date(Math.floor((now - 2 * day) / 1000) * 1000);
  const listed = await signedPdf(leaf, { revocation: { where: "dss", crls: [await crl(root, at, [{ serial: 2, at: revokedAt }])] } });
  expect((await verifyWithDss(listed, { roots: [root.der], intermediates: [] })).revocation).toMatchObject({ status: "revoked", source: "crl", revokedAt: revokedAt.toISOString() });
  const clean = await signedPdf(leaf, { revocation: { where: "cms", crls: [await crl(root, at, [{ serial: 99, at: revokedAt }])] } });
  expect((await verify(clean, { roots: [root.der], intermediates: [] })).revocation).toMatchObject({ status: "good", source: "crl" });
  // 別人簽的撤銷清單
  const other = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(now - 2 * day), to: new Date(now + day) });
  const forged = await signedPdf(leaf, { revocation: { where: "dss", crls: [await crl(other, at, [{ serial: 2, at: revokedAt }])] } });
  expect((await verifyWithDss(forged, { roots: [root.der], intermediates: [] })).revocation).toEqual({ status: "unverified", source: "crl" });
});

test("撤銷狀態：撤銷的時間晚於可信的時間戳記", async () => {
  const { root, leaf } = await setup();
  const { tsaRoot, tsa } = await tsaSetup();
  const ocsp = await ocspResponse(leaf, root, { status: "revoked", at: new Date(now - day), revokedAt: new Date(now - 2 * day) });
  const pdf = await signedPdf(leaf, { timestamp: { tsa, at: new Date(now - 10 * day) }, revocation: { where: "cms", ocsps: [ocsp] } });
  const result = await verify(pdf, { roots: [root.der], intermediates: [], tsaRoots: [tsaRoot.der] });
  expect(result.revocation).toMatchObject({ status: "revoked", afterTimestamp: true });
});

test("撤銷狀態：沒有撤銷資料時沒有檢查，憑證鏈接不到時不檢查", async () => {
  const { root, leaf } = await setup();
  const pdf = await signedPdf(leaf);
  expect((await verify(pdf, { roots: [root.der], intermediates: [] })).revocation).toEqual({ status: "not-checked" });
  expect((await verify(pdf, { roots: [], intermediates: [] })).revocation).toBeUndefined();
});

test("/DSS 裡的中繼憑證用來建憑證鏈", async () => {
  const root = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const mid = await makeCert({ cn: "Gears Test CA", ca: true, issuer: root, serial: 3, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const leaf = await makeCert({ cn: "測試簽署人", issuer: mid, serial: 4, from: new Date(now - day), to: new Date(now + 365 * day) });
  const pdf = await signedPdf(leaf, { revocation: { where: "dss", certs: [mid.der], ocsps: [await ocspResponse(leaf, mid, { status: "good", at: new Date(now - day) })] } });
  const result = await verifyWithDss(pdf, { roots: [root.der], intermediates: [] });
  expect(result.chain).toBe("trusted");
  expect(result.revocation).toMatchObject({ status: "good", source: "ocsp" });
});

// 中繼憑證的撤銷：根憑證簽的撤銷清單（ARL）列出中繼憑證，時間戳記服務的憑證也一樣檢查（#128）
async function chainSetup() {
  const root = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const mid = await makeCert({ cn: "Gears Test CA", ca: true, issuer: root, serial: 3, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const leaf = await makeCert({ cn: "測試簽署人", issuer: mid, serial: 4, from: new Date(now - day), to: new Date(now + 365 * day) });
  return { root, mid, leaf };
}

test("撤銷狀態：中繼憑證由根憑證的撤銷清單檢查，沒有資料時沒有檢查", async () => {
  const { root, mid, leaf } = await chainSetup();
  const at = new Date(now - day);
  const revokedAt = new Date(Math.floor((now - 2 * day) / 1000) * 1000);
  const leafGood = await ocspResponse(leaf, mid, { status: "good", at });
  const trust = { roots: [root.der], intermediates: [mid.der] };

  const revoked = await verifyWithDss(await signedPdf(leaf, { revocation: { where: "dss", ocsps: [leafGood], crls: [await crl(root, at, [{ serial: 3, at: revokedAt }])] } }), trust);
  expect(revoked.revocation).toMatchObject({ status: "good", source: "ocsp" });
  expect(revoked.chainRevocation).toHaveLength(1);
  expect(revoked.chainRevocation![0]!.subject).toContain("CN=Gears Test CA");
  expect(revoked.chainRevocation![0]!.check).toMatchObject({ status: "revoked", source: "crl", revokedAt: revokedAt.toISOString() });

  const good = await verifyWithDss(await signedPdf(leaf, { revocation: { where: "cms", ocsps: [leafGood], crls: [await crl(root, at, [])] } }), trust);
  expect(good.chainRevocation![0]!.check).toMatchObject({ status: "good", source: "crl" });

  // 簽署者的簽發者（中繼憑證）簽的撤銷清單不能用來判斷中繼憑證自己
  const wrong = await verifyWithDss(await signedPdf(leaf, { revocation: { where: "dss", crls: [await crl(mid, at, [{ serial: 3, at: revokedAt }])] } }), trust);
  expect(wrong.chainRevocation![0]!.check).toEqual({ status: "not-checked" });
  // 簽署者直接由根憑證簽發時沒有中繼憑證
  const { root: r2, leaf: l2 } = await setup();
  expect((await verify(await signedPdf(l2), { roots: [r2.der], intermediates: [] })).chainRevocation).toBeUndefined();
});

test("撤銷狀態：中繼憑證在可信的時間戳記之後才被撤銷", async () => {
  const { root, mid, leaf } = await chainSetup();
  const { tsaRoot, tsa } = await tsaSetup();
  const revokedAt = new Date(Math.floor((now - 2 * day) / 1000) * 1000);
  const pdf = await signedPdf(leaf, { timestamp: { tsa, at: new Date(now - 10 * day) }, revocation: { where: "cms", crls: [await crl(root, new Date(now - day), [{ serial: 3, at: revokedAt }])] } });
  const result = await verify(pdf, { roots: [root.der], intermediates: [mid.der], tsaRoots: [tsaRoot.der] });
  expect(result.chainRevocation![0]!.check).toMatchObject({ status: "revoked", afterTimestamp: true });
});

test("撤銷狀態：時間戳記服務的憑證被撤銷時，它證明的時間不採信", async () => {
  const { root, leaf } = await setup();
  const { tsaRoot, tsa } = await tsaSetup();
  const at = new Date(now - day);
  const tsaRevoked = await crl(tsaRoot, at, [{ serial: 12, at: new Date(Math.floor((now - 20 * day) / 1000) * 1000) }]);
  // 簽署者在時間戳記之後才被撤銷：時間戳記可信時算在撤銷之前，時間戳記服務被撤銷時就不算
  const leafRevoked = await ocspResponse(leaf, root, { status: "revoked", at, revokedAt: new Date(now - 2 * day) });
  const trust = { roots: [root.der], intermediates: [], tsaRoots: [tsaRoot.der] };
  const result = await verify(await signedPdf(leaf, { timestamp: { tsa, at: new Date(now - 10 * day) }, revocation: { where: "cms", ocsps: [leafRevoked], crls: [tsaRevoked] } }), trust);
  expect(result.timestamp).toMatchObject({ chain: "trusted", revocation: { status: "revoked", source: "crl" } });
  expect(result.revocation).toMatchObject({ status: "revoked" });
  expect(result.revocation!.afterTimestamp).toBeUndefined();

  const clean = await verify(await signedPdf(leaf, { timestamp: { tsa, at: new Date(now - 10 * day) }, revocation: { where: "cms", ocsps: [leafRevoked], crls: [await crl(tsaRoot, at, [])] } }), trust);
  expect(clean.timestamp!.revocation).toMatchObject({ status: "good", source: "crl" });
  expect(clean.revocation).toMatchObject({ status: "revoked", afterTimestamp: true });
});

test("撤銷狀態：時間戳記服務的中繼憑證被撤銷時，它證明的時間也不採信（#229）", async () => {
  const { root, leaf } = await setup();
  const tsaRoot = await makeCert({ cn: "Gears Test TSA Root", ca: true, serial: 11, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const tsaMid = await makeCert({ cn: "Gears Test TSA CA", ca: true, issuer: tsaRoot, serial: 13, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const tsa = await makeCert({ cn: "Gears Test TSA", issuer: tsaMid, serial: 14, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const at = new Date(now - day);
  const leafRevoked = await ocspResponse(leaf, root, { status: "revoked", at, revokedAt: new Date(now - 2 * day) });
  const trust = { roots: [root.der], intermediates: [tsaMid.der], tsaRoots: [tsaRoot.der] };
  const sign = (crls: Uint8Array[]) => signedPdf(leaf, { timestamp: { tsa, at: new Date(now - 10 * day) }, revocation: { where: "cms", ocsps: [leafRevoked], crls } });

  const midRevoked = await verify(await sign([await crl(tsaRoot, at, [{ serial: 13, at: new Date(Math.floor((now - 20 * day) / 1000) * 1000) }])]), trust);
  expect(midRevoked.timestamp).toMatchObject({ chain: "trusted" });
  expect(midRevoked.timestamp!.chainRevocation).toHaveLength(1);
  expect(midRevoked.timestamp!.chainRevocation![0]!.subject).toContain("CN=Gears Test TSA CA");
  expect(midRevoked.timestamp!.chainRevocation![0]!.check).toMatchObject({ status: "revoked", source: "crl" });
  // 時間戳記不採信，簽署者在那之後的撤銷就不算成撤銷之前已經存在
  expect(midRevoked.revocation!.afterTimestamp).toBeUndefined();

  const clean = await verify(await sign([await crl(tsaRoot, at, [])]), trust);
  expect(clean.timestamp!.chainRevocation![0]!.check).toMatchObject({ status: "good", source: "crl" });
  expect(clean.revocation).toMatchObject({ status: "revoked", afterTimestamp: true });
});

test("撤銷狀態：整份文件的時間戳記也檢查時間戳記服務的憑證", async () => {
  const { tsaRoot, tsa } = await tsaSetup();
  const at = new Date(now - day);
  const pdf = await signedPdf(tsa, { document: true, timestamp: { tsa, at }, revocation: { where: "dss", crls: [await crl(tsaRoot, at, [{ serial: 12, at: new Date(Math.floor((now - 2 * day) / 1000) * 1000) }])] } });
  const result = await verifyWithDss(pdf, { roots: [], intermediates: [], tsaRoots: [tsaRoot.der] });
  expect(result).toMatchObject({ kind: "document", chain: "trusted" });
  expect(result.timestamp!.revocation).toMatchObject({ status: "revoked", source: "crl" });
});

test("中繼憑證與時間戳記服務的撤銷狀態：說明與需要留意的地方", async () => {
  const { traceLines } = await import("../../src/ui/verify-report.ts");
  const { summarize } = await import("../../src/tools/verify/summary.ts");
  const base = { integrity: "intact", signature: "valid", chain: "trusted", root: "CN=Root", signer: "CN=測試簽署人", kind: "signature", revocation: { status: "good", source: "ocsp" } } as const;
  const evidence = (extra: Partial<PdfSignatureCheck>) => {
    const ev = { times: [], devices: [], serials: [], software: [], people: [], locations: [], traces: [], revisions: [], signatures: [{ coversWhole: true, check: { ...base, ...extra } }] };
    return ev as unknown as Parameters<typeof traceLines>[0];
  };
  const lines = (extra: Partial<PdfSignatureCheck>) => traceLines(evidence(extra)).join("\n");
  const warnings = (extra: Partial<PdfSignatureCheck>) => summarize([{ index: 1, name: "a.pdf", format: "pdf", size: 1, evidence: evidence(extra) }]).warnings;

  const mid = (check: PdfSignatureCheck["revocation"]) => ({ chainRevocation: [{ subject: "CN=Mid CA", check: check! }] });
  expect(lines(mid({ status: "good", source: "crl", checkedAt: "2026-10-01T00:00:00.000Z" }))).toContain("中繼憑證 CN=Mid CA：檔案裡附的撤銷資料（憑證撤銷清單，");
  expect(lines(mid({ status: "not-checked" }))).toContain("中繼憑證 CN=Mid CA：檔案裡沒有附撤銷資料");
  expect(lines(mid({ status: "revoked", source: "crl", revokedAt: "2026-10-01T00:00:00.000Z" }))).toContain("中繼憑證 CN=Mid CA 已被撤銷");
  expect(warnings(mid({ status: "revoked", source: "crl" }))).toContainEqual(expect.objectContaining({ code: "pdf-chain-revoked", value: "CN=Mid CA" }));
  expect(warnings(mid({ status: "revoked", source: "crl", afterTimestamp: true })).map((w) => w.code)).not.toContain("pdf-chain-revoked");
  expect(warnings(mid({ status: "good", source: "crl" })).map((w) => w.code)).not.toContain("pdf-chain-revoked");

  const stamp = { time: "2026-10-01T00:00:00.000Z", tsa: "CN=TSA", imprint: "match", signature: "valid", chain: "trusted", root: "CN=TSA Root" } as const;
  const tsaRevoked = { timestamp: { ...stamp, revocation: { status: "revoked", source: "ocsp", revokedAt: "2026-09-01T00:00:00.000Z" } } } as const;
  expect(lines(tsaRevoked)).toContain("時間戳記服務的憑證 CN=TSA 已被撤銷");
  expect(warnings(tsaRevoked)).toContainEqual(expect.objectContaining({ code: "pdf-chain-revoked", value: "CN=TSA" }));
  const tsaMidRevoked: Partial<PdfSignatureCheck> = { timestamp: { ...stamp, chainRevocation: [{ subject: "CN=TSA CA", check: { status: "revoked", source: "crl" } }] } };
  expect(lines(tsaMidRevoked)).toContain("中繼憑證 CN=TSA CA 已被撤銷");
  expect(warnings(tsaMidRevoked)).toContainEqual(expect.objectContaining({ code: "pdf-chain-revoked", value: "CN=TSA CA" }));
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


test("撤銷狀態的說明與需要留意的地方", async () => {
  const { traceLines } = await import("../../src/ui/verify-report.ts");
  const { summarize } = await import("../../src/tools/verify/summary.ts");
  const base = { integrity: "intact", signature: "valid", chain: "trusted", root: "CN=Root", signer: "CN=測試簽署人", kind: "signature" } as const;
  const evidence = (revocation: PdfSignatureCheck["revocation"]) => {
    const ev = { times: [], devices: [], serials: [], software: [], people: [], locations: [], traces: [], revisions: [], signatures: [{ coversWhole: true, check: { ...base, revocation } }] };
    return ev as unknown as Parameters<typeof traceLines>[0];
  };
  const lines = (r: PdfSignatureCheck["revocation"]) => traceLines(evidence(r)).join("\n");
  const codes = (r: PdfSignatureCheck["revocation"]) => summarize([{ index: 1, name: "a.pdf", format: "pdf", size: 1, evidence: evidence(r) }]).warnings.map((w) => w.code);

  expect(lines({ status: "good", source: "ocsp", checkedAt: "2026-10-01T00:00:00.000Z" })).toContain("撤銷狀態：檔案裡附的撤銷資料（OCSP 回應，");
  expect(lines({ status: "revoked", source: "crl", revokedAt: "2026-10-01T00:00:00.000Z" })).toContain("憑證已被撤銷：檔案裡附的撤銷資料（憑證撤銷清單）寫著撤銷的時間是");
  expect(lines({ status: "revoked", source: "ocsp", revokedAt: "2026-10-01T00:00:00.000Z", afterTimestamp: true })).toContain("可信的時間戳記證明簽章在撤銷之前就已經存在");
  expect(lines({ status: "unverified", source: "ocsp" })).toContain("撤銷狀態沒有確認");
  expect(lines({ status: "not-checked" })).toContain("撤銷狀態沒有檢查");
  expect(codes({ status: "revoked", source: "crl" })).toContain("pdf-signature-revoked");
  expect(codes({ status: "revoked", source: "crl", afterTimestamp: true })).not.toContain("pdf-signature-revoked");
  expect(codes({ status: "good", source: "crl" })).not.toContain("pdf-signature-revoked");
});

test("簽署的範圍：起點不是檔案開頭，或空隙裡不只有 /Contents，都不算驗證通過", async () => {
  const { root, leaf } = await setup();
  const pdf = await signedPdf(leaf);
  const ev = await examine(pdf, "pdf");
  const sig = ev.signatures[0]!;
  const [a, b, c, d] = sig.byteRange as [number, number, number, number];
  expect(gapIsContents(pdf, sig.byteRange!, sig.contents!)).toBe(true);
  const trust = { roots: [root.der], intermediates: [] };

  // 起點往後移：前面的位元組沒被簽到
  expect(await verifyPdfSignature(pdf, { byteRange: [8, b - 8, c, d], contents: sig.contents! }, trust)).toMatchObject({ signature: "unsupported", integrity: "unknown" });

  // 空隙裡 /Contents 後面多了別的東西：把補零的尾巴換成另一個物件，簽署的範圍一個位元組都沒動
  const tampered = pdf.slice();
  const extra = new TextEncoder().encode("> /X <");
  tampered.set(extra, c - 1 - extra.length - 8);
  expect(gapIsContents(tampered, sig.byteRange!, sig.contents!)).toBe(false);
  expect(await verifyPdfSignature(tampered, { byteRange: [a, b, c, d], contents: sig.contents! }, trust)).toMatchObject({ signature: "invalid", integrity: "changed" });
});

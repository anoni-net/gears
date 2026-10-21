import type * as Pkijs from "pkijs";

// PDF 數位簽章的驗證（anoni-net/gears#128），用 pkijs（BSD-3-Clause）解析 CMS 與 X.509，
// 密碼運算交給瀏覽器的 crypto.subtle：
//
// 1. 簽章本身：依 /ByteRange 取出簽署的範圍算摘要，比對 CMS 裡的 messageDigest，再用簽署者憑證的
//    公鑰驗簽章值。只需要檔案本身，驗得過代表簽完之後涵蓋的範圍沒被改過
// 2. 簽署者：用簽章附的憑證與內建的中繼憑證建憑證鏈，接到內建的根憑證（台灣政府憑證總管理中心
//    GRCA 的三代根憑證）才算確認身分。現在驗不過時，再用簽章裡簽署端自己填的時間驗一次：憑證
//    過期之後簽的、還是過期之前簽的，沒有時間戳記就分不出來，畫面上寫明
// 3. 時間戳記（RFC 3161）：附在簽章上的（證明簽章值在那個時間已經存在），或整份文件的時間戳記
//    （/SubFilter 為 ETSI.RFC3161，直接證明簽署的範圍）。驗時間戳記服務的簽章與憑證鏈，接到內建的
//    根憑證才採信，簽署者的憑證現在過期時，用時間戳記證明的時間再驗一次
// 4. 撤銷狀態：只讀檔案裡已經存好的資料，簽章裡附的（adbe-revocationInfoArchival 與 CMS 的
//    crls）與長期驗證存在 /DSS 的 OCSP 回應與撤銷清單（CRL），不連線查詢。只檢查簽署者的憑證，
//    憑證鏈接到內建的根憑證才檢查，接不到的話分不出撤銷資料是誰簽的
//
// 只給線索：簽章有效不代表文件的內容是真的，法律上的效力也不在這裡判斷

export interface RevocationData {
  certs: Uint8Array[]; // DER
  ocsps: Uint8Array[]; // OCSPResponse
  crls: Uint8Array[];
}

export interface PdfSignatureInput {
  byteRange: number[];
  contents: Uint8Array; // /Contents 的 CMS（DER），後面補的 0 不影響解析，不必拿掉
  dss?: RevocationData; // 文件的 /DSS，所有簽章共用
}

export interface TrustStore {
  roots: Uint8Array[]; // DER
  intermediates: Uint8Array[];
  tsaRoots?: Uint8Array[]; // 時間戳記服務另外採信的根憑證（C2PA 正式清單裡的時間戳記服務清單）
}

export interface TimestampCheck {
  time?: string; // 時間戳記證明的時間（genTime）
  tsa?: string; // 時間戳記服務憑證的主體
  imprint: "match" | "mismatch"; // 時間戳記裡的雜湊值跟它證明的資料一不一樣
  signature: "valid" | "invalid";
  chain: "trusted" | "untrusted";
  root?: string;
}

export interface RevocationCheck {
  // unverified：有這張憑證的撤銷資料，但簽章驗不過。not-checked：檔案裡沒有這張憑證的撤銷資料
  status: "good" | "revoked" | "unknown" | "unverified" | "not-checked";
  source?: "ocsp" | "crl";
  checkedAt?: string; // OCSP 回應產生的時間，或撤銷清單的發布時間
  revokedAt?: string;
  afterTimestamp?: boolean; // 撤銷的時間晚於可信的時間戳記，簽章在撤銷之前就已經存在
}

export interface PdfSignatureCheck {
  integrity: "intact" | "changed" | "unknown"; // 簽署的範圍算出的摘要跟簽章裡記的一不一樣
  signature: "valid" | "invalid" | "unsupported" | "unavailable"; // unavailable：瀏覽器沒有 crypto.subtle
  signer?: string; // 簽署者憑證的主體，照實列出（自然人憑證有姓名）
  issuer?: string;
  serial?: string;
  validFrom?: string;
  validTo?: string;
  signingTime?: string; // 簽署端自己填的時間（signingTime），不是時間戳記
  chain: "trusted" | "trusted-at-timestamp" | "trusted-at-signing" | "untrusted" | "not-checked";
  root?: string; // 憑證鏈接到的根憑證
  kind?: "signature" | "document"; // document：整份文件的時間戳記，簽署者就是時間戳記服務
  timestamp?: TimestampCheck;
  revocation?: RevocationCheck; // 憑證鏈接到內建的根憑證時才有
}

type Lib = typeof Pkijs;

const toBuffer = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

// 主體照憑證裡的順序寫成「C=TW, O=…, CN=…」，常見的屬性換成縮寫，其他的照 OID 列出
const NAMES: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "1.2.840.113549.1.9.1": "E",
};

export function nameText(name: Pkijs.RelativeDistinguishedNames): string {
  return name.typesAndValues
    .map((tv) => `${NAMES[tv.type] ?? tv.type}=${(tv.value.valueBlock as { value?: string }).value ?? ""}`)
    .join(", ")
    .slice(0, 300);
}

// PEM 檔裡的每一張憑證換成 DER，# 開頭的說明行略過
export function pemToDer(pem: string): Uint8Array[] {
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => {
    const bin = atob(m[1]!.replace(/\s+/g, ""));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  });
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// 簽署的範圍：/ByteRange 是 [起點1, 長度1, 起點2, 長度2]，中間空出來的是 /Contents 本身
function signedBytes(bytes: Uint8Array, range: number[]): Uint8Array | undefined {
  const [a, b, c, d] = range;
  if (range.length !== 4 || [a, b, c, d].some((n) => n === undefined || n < 0) || c! + d! > bytes.length || a! + b! > c!) return undefined;
  const out = new Uint8Array(b! + d!);
  out.set(bytes.subarray(a!, a! + b!), 0);
  out.set(bytes.subarray(c!, c! + d!), b!);
  return out;
}

function signingTime(info: Pkijs.SignerInfo): Date | undefined {
  const attr = info.signedAttrs?.attributes.find((a) => a.type === "1.2.840.113549.1.9.5");
  const value = attr?.values[0] as { toDate?: () => Date } | undefined;
  return value?.toDate?.();
}

const same = (a: Pkijs.Certificate, b: Pkijs.Certificate) => {
  const x = new Uint8Array(a.tbsView);
  const y = new Uint8Array(b.tbsView);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

const isCA = (c: Pkijs.Certificate) =>
  (c.extensions ?? []).some((e) => e.extnID === "2.5.29.19" && (e.parsedValue as { cA?: boolean } | undefined)?.cA === true);

// pkijs 的憑證鏈引擎先拿掉重複的憑證（留前面那一張），再把清單的最後一張當成要驗證的憑證。
// 簽署者的憑證也附在簽章裡，直接放進去的話最後一張會變成某張中繼憑證，驗的就不是簽署者，
// 自己做的憑證會被當成接到 GRCA。所以中繼憑證只放 CA、拿掉簽署者本身，驗完再確認路徑的
// 第一張就是簽署者
async function chainAt(lib: Lib, signer: Pkijs.Certificate, certs: Pkijs.Certificate[], trust: Pkijs.Certificate[], date: Date) {
  const cas = certs.filter((c) => isCA(c) && !same(c, signer));
  const engine = new lib.CertificateChainValidationEngine({ certs: [...cas, signer], trustedCerts: trust, checkDate: date });
  try {
    const result = await engine.verify({ passedWhenNotRevValues: true });
    const path = result.certificatePath ?? [];
    return result.result && path[0] && same(path[0], signer) ? path : undefined;
  } catch {
    return undefined;
  }
}

const parseCert = (lib: Lib, der: Uint8Array) => {
  try {
    return lib.Certificate.fromBER(toBuffer(der));
  } catch {
    return undefined;
  }
};
const certsOf = (lib: Lib, list: Uint8Array[] = []) => list.map((d) => parseCert(lib, d)).filter((c): c is Pkijs.Certificate => !!c);
const embeddedOf = (lib: Lib, signed: Pkijs.SignedData) => (signed.certificates ?? []).filter((c): c is Pkijs.Certificate => c instanceof lib.Certificate);

// 時間戳記（TimeStampToken）是一份 CMS，內容是 TSTInfo：雜湊演算法、它證明的資料的雜湊值與時間。
// pkijs 驗簽章時一併比對雜湊值（data 是它證明的資料）
async function verifyToken(lib: Lib, token: Pkijs.SignedData, covered: Uint8Array, trust: TrustStore): Promise<{ check: TimestampCheck; at?: Date }> {
  const check: TimestampCheck = { imprint: "match", signature: "invalid", chain: "untrusted" };
  let at: Date | undefined;
  try {
    const tst = lib.TSTInfo.fromBER(toBuffer(new Uint8Array(token.encapContentInfo.eContent!.valueBlock.valueHexView)));
    at = tst.genTime;
    check.time = at.toISOString();
  } catch {
    return { check };
  }
  let tsaCert: Pkijs.Certificate | null | undefined;
  try {
    const result = await token.verify({ signer: 0, data: toBuffer(covered), extendedMode: true, checkChain: false });
    tsaCert = result.signerCertificate;
    check.signature = result.signatureVerified ? "valid" : "invalid";
  } catch (e) {
    const err = e as { message?: string; signerCertificate?: Pkijs.Certificate | null };
    tsaCert = err.signerCertificate;
    if (/TSTInfo verification is failed/.test(err.message ?? "")) check.imprint = "mismatch";
  }
  if (!tsaCert) return { check, at };
  check.tsa = nameText(tsaCert.subject);
  if (check.signature !== "valid" || check.imprint !== "match") return { check, at };
  const roots = [...certsOf(lib, trust.roots), ...certsOf(lib, trust.tsaRoots)];
  const cas = [...embeddedOf(lib, token), ...certsOf(lib, trust.intermediates)];
  // 時間戳記服務的憑證也可能已經過期，看它簽發當時
  const path = (await chainAt(lib, tsaCert, cas, roots, new Date())) ?? (at ? await chainAt(lib, tsaCert, cas, roots, at) : undefined);
  if (path) {
    check.chain = "trusted";
    check.root = nameText(path.at(-1)!.subject);
  }
  return { check, at };
}

interface Revocations {
  ocsps: Pkijs.BasicOCSPResponse[];
  crls: Pkijs.CertificateRevocationList[];
}

// 簽章裡附的撤銷資料：Adobe 的 adbe-revocationInfoArchival（簽署的屬性，[0] 是 CRL、[1] 是 OCSP
// 回應）與 CMS 本身的 crls（RFC 5940 的 OCSP 回應放在 OtherRevocationInfoFormat），再加上 /DSS
function collectRevocations(lib: Lib, asn1: typeof import("asn1js"), signed: Pkijs.SignedData, info: Pkijs.SignerInfo, dss?: RevocationData): Revocations {
  const out: Revocations = { ocsps: [], crls: [] };
  const addOcsp = (schema: unknown) => {
    try {
      const bytes = new lib.OCSPResponse({ schema }).responseBytes;
      if (bytes?.responseType === "1.3.6.1.5.5.7.48.1.1") out.ocsps.push(lib.BasicOCSPResponse.fromBER(toBuffer(new Uint8Array(bytes.response.valueBlock.valueHexView))));
    } catch {
      // 讀不出來就略過
    }
  };
  const addCrl = (schema: unknown) => {
    try {
      out.crls.push(new lib.CertificateRevocationList({ schema }));
    } catch {
      // 讀不出來就略過
    }
  };
  const fromDer = (der: Uint8Array) => {
    const parsed = asn1.fromBER(toBuffer(der));
    return parsed.offset === -1 ? undefined : parsed.result;
  };

  const archival = info.signedAttrs?.attributes.find((a) => a.type === "1.2.840.113583.1.1.8")?.values[0];
  if (archival instanceof asn1.Sequence) {
    for (const item of archival.valueBlock.value) {
      if (item.idBlock.tagClass !== 3 || !(item instanceof asn1.Constructed)) continue;
      const list = item.valueBlock.value[0];
      if (!(list instanceof asn1.Sequence)) continue;
      for (const entry of list.valueBlock.value) {
        if (item.idBlock.tagNumber === 0) addCrl(entry);
        else if (item.idBlock.tagNumber === 1) addOcsp(entry);
      }
    }
  }
  for (const entry of signed.crls ?? []) {
    if (entry instanceof lib.CertificateRevocationList) out.crls.push(entry);
    else if (entry instanceof lib.OtherRevocationInfoFormat && entry.otherRevInfoFormat === "1.3.6.1.5.5.7.16.2") addOcsp(entry.otherRevInfo);
  }
  for (const der of dss?.ocsps ?? []) {
    const schema = fromDer(der);
    if (schema) addOcsp(schema);
  }
  for (const der of dss?.crls ?? []) {
    const schema = fromDer(der);
    if (schema) addCrl(schema);
  }
  return out;
}

// OCSP 回應由簽發者自己簽，或由簽發者授權的回應者簽：回應者的憑證由簽發者簽發、有 OCSP 簽署的
// 用途、回應產生時在效期內。pkijs 的 verify 用現在的時間驗回應者的憑證鏈，回應者的憑證效期
// 通常只有幾天，存在檔案裡的舊回應都會失敗，所以這裡自己判斷
async function ocspSignedBy(lib: Lib, basic: Pkijs.BasicOCSPResponse, issuer: Pkijs.Certificate, at: Date): Promise<boolean> {
  const engine = lib.getCrypto(true);
  for (const c of [issuer, ...(basic.certs ?? [])]) {
    let ok = false;
    try {
      ok = await engine.verifyWithPublicKey(toBuffer(new Uint8Array(basic.tbsResponseData.tbsView)), basic.signature, c.subjectPublicKeyInfo, basic.signatureAlgorithm);
    } catch {
      continue;
    }
    if (!ok) continue;
    if (same(c, issuer)) return true;
    const eku = c.extensions?.find((e) => e.extnID === "2.5.29.37")?.parsedValue as { keyPurposes?: string[] } | undefined;
    if (!eku?.keyPurposes?.includes("1.3.6.1.5.5.7.3.9")) continue;
    if (at < c.notBefore.value || at > c.notAfter.value) continue;
    try {
      if (await c.verify(issuer)) return true;
    } catch {
      // 不是簽發者簽的
    }
  }
  return false;
}

const RANK: Record<RevocationCheck["status"], number> = { "not-checked": 0, unverified: 1, unknown: 2, good: 3, revoked: 4 };

// 同一張憑證有好幾份撤銷資料時，被撤銷的優先，其次是沒有被撤銷
async function revocationOf(lib: Lib, cert: Pkijs.Certificate, issuer: Pkijs.Certificate, data: Revocations): Promise<RevocationCheck> {
  let result: RevocationCheck = { status: "not-checked" };
  const take = (r: RevocationCheck) => {
    if (RANK[r.status] > RANK[result.status]) result = r;
  };
  for (const basic of data.ocsps) {
    let status: { isForCertificate: boolean; status: number };
    try {
      status = await basic.getCertificateStatus(cert, issuer);
    } catch {
      continue;
    }
    if (!status.isForCertificate) continue;
    const producedAt = basic.tbsResponseData.producedAt;
    if (!(await ocspSignedBy(lib, basic, issuer, producedAt))) {
      take({ status: "unverified", source: "ocsp" });
      continue;
    }
    const r: RevocationCheck = { status: status.status === 0 ? "good" : status.status === 1 ? "revoked" : "unknown", source: "ocsp", checkedAt: producedAt.toISOString() };
    if (r.status === "revoked") {
      const single = basic.tbsResponseData.responses.find((x) => x.certID.serialNumber.isEqual(cert.serialNumber) && x.certStatus.idBlock.tagNumber === 1);
      const when = (single?.certStatus as { valueBlock?: { value?: { toDate?: () => Date }[] } } | undefined)?.valueBlock?.value?.[0]?.toDate?.();
      if (when) r.revokedAt = when.toISOString();
    }
    take(r);
  }
  for (const crl of data.crls) {
    if (!crl.issuer.isEqual(issuer.subject)) continue;
    let ok = false;
    try {
      ok = await crl.verify({ issuerCertificate: issuer });
    } catch {
      // 驗不過
    }
    if (!ok) {
      take({ status: "unverified", source: "crl" });
      continue;
    }
    const entry = crl.revokedCertificates?.find((r) => r.userCertificate.isEqual(cert.serialNumber));
    const checkedAt = crl.thisUpdate.value.toISOString();
    take(entry ? { status: "revoked", source: "crl", checkedAt, revokedAt: entry.revocationDate.value.toISOString() } : { status: "good", source: "crl", checkedAt });
  }
  return result;
}

export async function verifyPdfSignature(bytes: Uint8Array, input: PdfSignatureInput, trust: TrustStore): Promise<PdfSignatureCheck> {
  const lib: Lib = await import("pkijs");
  const asn1: typeof import("asn1js") = await import("asn1js");
  const out: PdfSignatureCheck = { integrity: "unknown", signature: "unsupported", chain: "not-checked" };

  let signed: Pkijs.SignedData;
  try {
    const parsed = asn1.fromBER(toBuffer(input.contents));
    if (parsed.offset === -1) return out;
    const info = new lib.ContentInfo({ schema: parsed.result });
    if (info.contentType !== lib.ContentInfo.SIGNED_DATA) return out;
    signed = new lib.SignedData({ schema: info.content });
  } catch {
    return out;
  }
  const data = signedBytes(bytes, input.byteRange);
  const signerInfo = signed.signerInfos[0];
  if (!data || !signerInfo) return out;

  // 整份文件的時間戳記：簽署者是時間戳記服務，證明簽署的範圍在那個時間已經存在
  if (signed.encapContentInfo.eContentType === "1.2.840.113549.1.9.16.1.4") {
    const { check } = await verifyToken(lib, signed, data, trust);
    out.kind = "document";
    out.timestamp = check;
    out.integrity = check.imprint === "match" ? "intact" : "changed";
    out.signature = check.imprint === "match" ? check.signature : "invalid";
    out.signer = check.tsa;
    out.chain = check.chain;
    out.root = check.root;
    return out;
  }
  out.kind = "signature";

  const time = signingTime(signerInfo);
  if (time) out.signingTime = time.toISOString();

  // 第一層：摘要與簽章值，不檢查憑證鏈
  let signerCert: Pkijs.Certificate | null | undefined;
  try {
    const result = await signed.verify({ signer: 0, data: toBuffer(data), extendedMode: true, checkChain: false });
    signerCert = result.signerCertificate;
    out.integrity = "intact";
    out.signature = result.signatureVerified ? "valid" : "invalid";
  } catch (e) {
    const err = e as { code?: number; message?: string; signerCertificate?: Pkijs.Certificate | null };
    signerCert = err.signerCertificate;
    if (err.code === 15 && /Message digest doesn't match/.test(err.message ?? "")) {
      out.integrity = "changed";
      out.signature = "invalid";
    } else if (err.code === 7) out.signature = "unsupported";
    else out.signature = "invalid";
  }
  if (!signerCert) return out;
  out.signer = nameText(signerCert.subject);
  out.issuer = nameText(signerCert.issuer);
  out.serial = hex(signerCert.serialNumber.valueBlock.valueHexView.slice().buffer as ArrayBuffer);
  out.validFrom = signerCert.notBefore.value.toISOString();
  out.validTo = signerCert.notAfter.value.toISOString();
  if (out.signature !== "valid") return out;

  // 第三層：附在簽章上的時間戳記，證明簽章值（signerInfo.signature）在那個時間已經存在
  let trustedAt: Date | undefined;
  const tokenAttr = signerInfo.unsignedAttrs?.attributes.find((a) => a.type === "1.2.840.113549.1.9.16.2.14");
  if (tokenAttr?.values[0]) {
    try {
      const info = new lib.ContentInfo({ schema: tokenAttr.values[0] });
      const { check, at } = await verifyToken(lib, new lib.SignedData({ schema: info.content }), new Uint8Array(signerInfo.signature.valueBlock.valueHexView), trust);
      out.timestamp = check;
      if (check.chain === "trusted") trustedAt = at;
    } catch {
      out.timestamp = { imprint: "mismatch", signature: "invalid", chain: "untrusted" };
    }
  }

  // 第二層：憑證鏈接到內建的根憑證。先看現在，驗不過再看時間戳記證明的時間，最後才看簽署端自己填的
  const roots = certsOf(lib, trust.roots);
  const intermediates = [...embeddedOf(lib, signed), ...certsOf(lib, input.dss?.certs), ...certsOf(lib, trust.intermediates)];
  let path = await chainAt(lib, signerCert, intermediates, roots, new Date());
  out.chain = path ? "trusted" : "untrusted";
  if (!path && trustedAt) {
    path = await chainAt(lib, signerCert, intermediates, roots, trustedAt);
    if (path) out.chain = "trusted-at-timestamp";
  }
  if (!path && time) {
    path = await chainAt(lib, signerCert, intermediates, roots, time);
    if (path) out.chain = "trusted-at-signing";
  }
  const root = path?.at(-1);
  if (root) out.root = nameText(root.subject);

  // 第四層：撤銷狀態。簽發者是憑證鏈的下一張
  const issuer = path?.[1];
  if (issuer) {
    out.revocation = await revocationOf(lib, signerCert, issuer, collectRevocations(lib, asn1, signed, signerInfo, input.dss));
    const revokedAt = out.revocation.revokedAt ? new Date(out.revocation.revokedAt) : undefined;
    if (revokedAt && trustedAt && revokedAt > trustedAt) out.revocation.afterTimestamp = true;
  }
  return out;
}

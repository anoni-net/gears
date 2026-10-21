import type * as Pkijs from "pkijs";

// PDF 數位簽章的驗證（anoni-net/gears#128 的第一、二層），用 pkijs（BSD-3-Clause）解析 CMS 與 X.509，
// 密碼運算交給瀏覽器的 crypto.subtle：
//
// 1. 簽章本身：依 /ByteRange 取出簽署的範圍算摘要，比對 CMS 裡的 messageDigest，再用簽署者憑證的
//    公鑰驗簽章值。只需要檔案本身，驗得過代表簽完之後涵蓋的範圍沒被改過
// 2. 簽署者：用簽章附的憑證與內建的中繼憑證建憑證鏈，接到內建的根憑證（台灣政府憑證總管理中心
//    GRCA 的三代根憑證）才算確認身分。現在驗不過時，再用簽章裡簽署端自己填的時間驗一次：憑證
//    過期之後簽的、還是過期之前簽的，沒有時間戳記就分不出來，畫面上寫明
//
// 只給線索：簽章有效不代表文件的內容是真的，法律上的效力也不在這裡判斷

export interface PdfSignatureInput {
  byteRange: number[];
  contents: Uint8Array; // /Contents 的 CMS（DER），後面補的 0 不影響解析，不必拿掉
}

export interface TrustStore {
  roots: Uint8Array[]; // DER
  intermediates: Uint8Array[];
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
  chain: "trusted" | "trusted-at-signing" | "untrusted" | "not-checked";
  root?: string; // 憑證鏈接到的根憑證
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

  // 第二層：憑證鏈接到內建的根憑證。先看現在，驗不過再看簽署端自己填的時間
  const parse = (der: Uint8Array) => {
    try {
      return lib.Certificate.fromBER(toBuffer(der));
    } catch {
      return undefined;
    }
  };
  const roots = trust.roots.map(parse).filter((c): c is Pkijs.Certificate => !!c);
  const embedded = (signed.certificates ?? []).filter((c): c is Pkijs.Certificate => c instanceof lib.Certificate);
  const intermediates = [...embedded, ...trust.intermediates.map(parse).filter((c): c is Pkijs.Certificate => !!c)];
  let path = await chainAt(lib, signerCert, intermediates, roots, new Date());
  out.chain = path ? "trusted" : "untrusted";
  if (!path && time) {
    path = await chainAt(lib, signerCert, intermediates, roots, time);
    if (path) out.chain = "trusted-at-signing";
  }
  const root = path?.at(-1);
  if (root) out.root = nameText(root.subject);
  return out;
}

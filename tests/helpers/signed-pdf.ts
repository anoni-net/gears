import * as asn1js from "asn1js";
import { PDFDocument, PDFHexString, StandardFonts } from "pdf-lib";
import * as pkijs from "pkijs";

// 測試用的 PDF 數位簽章：在測試裡產生根憑證與簽署者的憑證（ECDSA P-256），照 PDF 的做法
// 先留 /ByteRange 與 /Contents 的空位，算出簽署範圍之後填進 CMS（adbe.pkcs7.detached）。
// 時間戳記（RFC 3161）由測試裡的時間戳記服務憑證簽出 TSTInfo，可以附在簽章上（unsignedAttrs），
// 也可以做成整份文件的時間戳記（/SubFilter 為 ETSI.RFC3161）。
// 憑證與姓名都是編出來的，不對應任何真實的人或機構

const subtle = globalThis.crypto.subtle;
const KEY = { name: "ECDSA", namedCurve: "P-256" } as const;

export interface TestCert {
  cert: pkijs.Certificate;
  key: CryptoKey;
  der: Uint8Array;
}

function name(cn: string, org: string) {
  const n = new pkijs.RelativeDistinguishedNames();
  n.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.6", value: new asn1js.PrintableString({ value: "TW" }) }));
  n.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.10", value: new asn1js.Utf8String({ value: org }) }));
  n.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: cn }) }));
  return n;
}

export async function makeCert(opts: { cn: string; org?: string; issuer?: TestCert; ca?: boolean; serial: number; from: Date; to: Date }): Promise<TestCert> {
  const keys = (await subtle.generateKey(KEY, true, ["sign", "verify"])) as CryptoKeyPair;
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: opts.serial });
  cert.subject = name(opts.cn, opts.org ?? "Gears Test");
  cert.issuer = opts.issuer ? opts.issuer.cert.subject : cert.subject;
  cert.notBefore.value = opts.from;
  cert.notAfter.value = opts.to;
  const usage = new Uint8Array([opts.ca ? 0x06 : 0x80]); // keyCertSign + cRLSign，或 digitalSignature
  cert.extensions = [
    new pkijs.Extension({ extnID: "2.5.29.19", critical: true, extnValue: new pkijs.BasicConstraints({ cA: !!opts.ca }).toSchema().toBER(false), parsedValue: new pkijs.BasicConstraints({ cA: !!opts.ca }) }),
    new pkijs.Extension({ extnID: "2.5.29.15", critical: true, extnValue: new asn1js.BitString({ valueHex: usage.buffer }).toBER(false) }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(opts.issuer?.key ?? keys.privateKey, "SHA-256");
  return { cert, key: keys.privateKey, der: new Uint8Array(cert.toSchema(true).toBER(false)) };
}

const TST_INFO = "1.2.840.113549.1.9.16.1.4";

// 時間戳記服務簽出的 TimeStampToken：TSTInfo 記著 data 的 SHA-256 與時間。imprint 給了就用它代替
// data 的雜湊值，做出跟資料對不上的時間戳記
export async function timestampToken(tsa: TestCert, data: Uint8Array, at: Date, opts: { imprint?: Uint8Array } = {}): Promise<asn1js.Sequence> {
  const hashed = opts.imprint ?? new Uint8Array(await subtle.digest("SHA-256", data.slice()));
  const tst = new pkijs.TSTInfo({
    version: 1,
    policy: "1.3.6.1.4.1.99999.1",
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: "2.16.840.1.101.3.4.2.1" }),
      hashedMessage: new asn1js.OctetString({ valueHex: hashed.slice().buffer }),
    }),
    serialNumber: new asn1js.Integer({ value: 7 }),
    genTime: at,
  });
  const content = tst.toSchema().toBER(false);
  // pkijs 建立時把 eContent 換成分段的 OctetString，時間戳記服務實際送出的是一整段，事後換回來
  const encap = new pkijs.EncapsulatedContentInfo({ eContentType: TST_INFO });
  encap.eContent = new asn1js.OctetString({ valueHex: content });
  const signed = new pkijs.SignedData({
    version: 3,
    encapContentInfo: encap,
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: tsa.cert.issuer, serialNumber: tsa.cert.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: TST_INFO })] }),
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: await subtle.digest("SHA-256", content) })] }),
          ],
        }),
      }),
    ],
    certificates: [tsa.cert],
  });
  await signed.sign(tsa.key, 0, "SHA-256");
  return new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) }).toSchema() as asn1js.Sequence;
}

const PLACEHOLDER = 9_999_999_999;
const CONTENTS_SIZE = 8192; // CMS 的空位，16 進位寫成兩倍長

export interface SignOptions {
  signedAt?: Date;
  tamper?: boolean;
  timestamp?: { tsa: TestCert; at: Date; wrong?: boolean }; // 附在簽章上的時間戳記，wrong 時雜湊值對不上
  document?: boolean; // 整份文件的時間戳記：signer 是時間戳記服務，時間取 timestamp.at
}

export async function signedPdf(signer: TestCert, opts: SignOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 200]);
  page.drawText("Signed contract", { x: 20, y: 100, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const sig = doc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: opts.document ? "ETSI.RFC3161" : "adbe.pkcs7.detached",
    ByteRange: [0, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER],
    Contents: PDFHexString.of("0".repeat(CONTENTS_SIZE * 2)),
    Name: "Test Signer",
  });
  doc.context.register(sig);
  const bytes = await doc.save({ useObjectStreams: false });

  const text = new TextDecoder("latin1").decode(bytes);
  const rangeAt = text.indexOf("/ByteRange [");
  const rangeEnd = text.indexOf("]", rangeAt) + 1;
  const contentsAt = text.indexOf(`<${"0".repeat(64)}`);
  const contentsEnd = text.indexOf(">", contentsAt) + 1;
  const range = [0, contentsAt, contentsEnd, bytes.length - contentsEnd];
  const rangeText = `/ByteRange [${range.join(" ")}]`.padEnd(rangeEnd - rangeAt, " ");
  const out = new Uint8Array(bytes);
  out.set(new TextEncoder().encode(rangeText), rangeAt);

  const data = new Uint8Array(range[1]! + range[3]!);
  data.set(out.subarray(0, contentsAt), 0);
  data.set(out.subarray(contentsEnd), contentsAt);
  const digest = await subtle.digest("SHA-256", data);

  const cms = opts.document ? new Uint8Array((await timestampToken(signer, data, opts.timestamp?.at ?? new Date())).toBER(false)) : await detached(signer, digest, opts);
  const hexCms = [...cms].map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(CONTENTS_SIZE * 2, "0");
  out.set(new TextEncoder().encode(hexCms), contentsAt + 1);

  // 簽完之後改掉簽署範圍裡的一個位元組：檔頭第二行的二進位註解，不影響解析
  if (opts.tamper) out[10] ^= 0x01;
  return out;
}

async function detached(signer: TestCert, digest: ArrayBuffer, opts: SignOptions): Promise<Uint8Array> {
  const signed = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.7.1" }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: signer.cert.issuer, serialNumber: signer.cert.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: "1.2.840.113549.1.7.1" })] }),
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: digest })] }),
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.5", values: [new asn1js.UTCTime({ valueDate: opts.signedAt ?? new Date() })] }),
          ],
        }),
      }),
    ],
    certificates: [signer.cert],
  });
  await signed.sign(signer.key, 0, "SHA-256");
  const info = signed.signerInfos[0]!;
  if (opts.timestamp) {
    const value = new Uint8Array(info.signature.valueBlock.valueHexView);
    const token = await timestampToken(opts.timestamp.tsa, value, opts.timestamp.at, opts.timestamp.wrong ? { imprint: new Uint8Array(32) } : {});
    info.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 1, attributes: [new pkijs.Attribute({ type: "1.2.840.113549.1.9.16.2.14", values: [token] })] });
  }
  return new Uint8Array(new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) }).toSchema().toBER(false));
}

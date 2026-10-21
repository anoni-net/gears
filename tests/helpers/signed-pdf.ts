import * as asn1js from "asn1js";
import { PDFDocument, PDFHexString, StandardFonts } from "pdf-lib";
import * as pkijs from "pkijs";

// 測試用的 PDF 數位簽章：在測試裡產生根憑證與簽署者的憑證（ECDSA P-256），照 PDF 的做法
// 先留 /ByteRange 與 /Contents 的空位，算出簽署範圍之後填進 CMS（adbe.pkcs7.detached）。
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

const PLACEHOLDER = 9_999_999_999;
const CONTENTS_SIZE = 8192; // CMS 的空位，16 進位寫成兩倍長

export async function signedPdf(signer: TestCert, opts: { signedAt?: Date; tamper?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 200]);
  page.drawText("Signed contract", { x: 20, y: 100, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const sig = doc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
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
  const cms = new Uint8Array(new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) }).toSchema().toBER(false));
  const hexCms = [...cms].map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(CONTENTS_SIZE * 2, "0");
  out.set(new TextEncoder().encode(hexCms), contentsAt + 1);

  // 簽完之後改掉簽署範圍裡的一個位元組：檔頭第二行的二進位註解，不影響解析
  if (opts.tamper) out[10] ^= 0x01;
  return out;
}

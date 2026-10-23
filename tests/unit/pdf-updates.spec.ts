import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { PDFArray, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { examine } from "../../src/tools/verify/examine.ts";
import { verifyPdfSignature } from "../../src/tools/verify/pdf-signature.ts";
import { summarize } from "../../src/tools/verify/summary.ts";
import { PADES } from "../global-setup.ts";
import { appendUpdate } from "../helpers/pdf-incremental.ts";
import { makeCert, signedPdf } from "../helpers/signed-pdf.ts";

// 簽完之後的增量更新是不是只加入驗證用的資料（src/tools/verify/pdf-updates.ts）。
// 每個測試在簽好的 PDF 後面接一次增量更新，看查證會不會列「簽章之後還有修改」

const day = 86_400_000;
const now = Date.now();

async function signed() {
  const root = await makeCert({ cn: "Gears Test Root", ca: true, serial: 1, from: new Date(now - 3650 * day), to: new Date(now + 3650 * day) });
  const leaf = await makeCert({ cn: "測試簽署人", issuer: root, serial: 2, from: new Date(now - day), to: new Date(now + 365 * day) });
  const bytes = await signedPdf(leaf);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  // pdf-lib 把頁面的 /Contents 寫成陣列
  const contents = doc.getPage(0).node.get(PDFName.of("Contents"));
  const contentRef = (contents instanceof PDFArray ? contents.get(0) : contents) as PDFRef;
  return { bytes, doc, catalogRef: doc.context.trailerInfo.Root as PDFRef, pageRef: doc.getPage(0).ref, contentRef, next: doc.context.largestObjectNumber + 1 };
}

const stream = (text: string) => `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;

async function check(bytes: Uint8Array) {
  const ev = await examine(bytes, "pdf");
  const sig = ev.signatures[0]!;
  const warnings = summarize([{ index: 1, name: "a.pdf", format: "pdf", size: bytes.length, evidence: ev }]).warnings.map((w) => w.code);
  return { sig, warnings };
}

test("簽完之後只加上 /DSS：不列簽章之後還有修改", async () => {
  const s = await signed();
  const cert = s.next;
  const dss = s.next + 1;
  s.doc.catalog.set(PDFName.of("DSS"), PDFRef.of(dss));
  s.doc.catalog.set(PDFName.of("Extensions"), s.doc.context.obj({ ESIC: { BaseVersion: PDFName.of("1.7"), ExtensionLevel: 1 } }));
  const bytes = await appendUpdate(s.bytes, [
    [cert, stream("certificate")],
    [dss, `<< /Certs [${cert} 0 R] /VRI << /ABCDEF << /Cert [${cert} 0 R] >> >> >>`],
    [s.catalogRef.objectNumber, s.doc.catalog.toString()],
  ]);
  const { sig, warnings } = await check(bytes);
  expect(sig.coversWhole).toBe(false);
  expect(sig.later).toEqual({ validationOnly: true, metadata: false });
  expect(warnings).not.toContain("signed-then-modified");
});

test("加上 /DSS 時一併更新 XMP：算驗證資料，另外標出中繼資料有更新", async () => {
  const s = await signed();
  const dss = s.next;
  const xmp = s.next + 1;
  s.doc.catalog.set(PDFName.of("DSS"), PDFRef.of(dss));
  s.doc.catalog.set(PDFName.of("Metadata"), PDFRef.of(xmp));
  const bytes = await appendUpdate(s.bytes, [
    [dss, "<< /Certs [] >>"],
    [xmp, `<< /Type /Metadata /Subtype /XML /Length 20 >>\nstream\n<x:xmpmeta></x:xmpmeta>\nendstream`],
    [s.catalogRef.objectNumber, s.doc.catalog.toString()],
  ]);
  const { sig } = await check(bytes);
  expect(sig.later).toEqual({ validationOnly: true, metadata: true });
  const { traceLines } = await import("../../src/ui/verify-report.ts");
  const lines = traceLines({ ...(await examine(bytes, "pdf")) }).join("\n");
  expect(lines).toContain("簽完之後只加入了長期驗證的資料與文件時間戳記（這裡沒有驗證憑證）");
  expect(lines).toContain("加入驗證資料的那次更新也改了文件的中繼資料");
});

test("文件時間戳記：簽章欄位加進 /AcroForm 與頁面的 /Annots", async () => {
  const s = await signed();
  const [sigDict, widget] = [s.next, s.next + 1];
  s.doc.catalog.set(PDFName.of("AcroForm"), s.doc.context.obj({ Fields: [PDFRef.of(widget)], SigFlags: 3 }));
  const page = s.doc.getPage(0).node;
  page.set(PDFName.of("Annots"), s.doc.context.obj([PDFRef.of(widget)]));
  const bytes = await appendUpdate(s.bytes, [
    [sigDict, "<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 0 0 0] /Contents <00> >>"],
    [widget, `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Timestamp) /V ${sigDict} 0 R /Rect [0 0 0 0] /P ${s.pageRef.toString()} >>`],
    [s.catalogRef.objectNumber, s.doc.catalog.toString()],
    [s.pageRef.objectNumber, page.toString()],
  ]);
  expect((await check(bytes)).sig.later).toEqual({ validationOnly: true, metadata: false });
});

test("簽完之後改了頁面的內容：列簽章之後還有修改", async () => {
  const s = await signed();
  const bytes = await appendUpdate(s.bytes, [[s.contentRef.objectNumber, stream("BT /F1 14 Tf 20 100 Td (Changed contract) Tj ET")]]);
  const { sig, warnings } = await check(bytes);
  expect(sig.later?.validationOnly).toBe(false);
  expect(warnings).toContain("signed-then-modified");
});

test("簽完之後加了一般的註解：不算驗證資料", async () => {
  const s = await signed();
  const note = s.next;
  const page = s.doc.getPage(0).node;
  page.set(PDFName.of("Annots"), s.doc.context.obj([PDFRef.of(note)]));
  const bytes = await appendUpdate(s.bytes, [
    [note, "<< /Type /Annot /Subtype /FreeText /Rect [20 20 200 60] /Contents (Paid) /DA (/Helv 12 Tf 0 g) >>"],
    [s.pageRef.objectNumber, page.toString()],
  ]);
  expect((await check(bytes)).sig.later?.validationOnly).toBe(false);
});

test("把頁面的內容掛到 /DSS 底下再改掉：不算驗證資料", async () => {
  const s = await signed();
  const dss = s.next;
  s.doc.catalog.set(PDFName.of("DSS"), PDFRef.of(dss));
  const bytes = await appendUpdate(s.bytes, [
    [dss, `<< /Certs [${s.contentRef.toString()}] >>`],
    [s.catalogRef.objectNumber, s.doc.catalog.toString()],
    [s.contentRef.objectNumber, stream("BT /F1 14 Tf 20 100 Td (Changed contract) Tj ET")],
  ]);
  expect((await check(bytes)).sig.later?.validationOnly).toBe(false);
});

test("文件目錄加上其他的鍵：不算驗證資料", async () => {
  const s = await signed();
  const dss = s.next;
  s.doc.catalog.set(PDFName.of("DSS"), PDFRef.of(dss));
  s.doc.catalog.set(PDFName.of("OpenAction"), s.doc.context.obj({ S: PDFName.of("JavaScript"), JS: "app.alert(1)" }));
  const bytes = await appendUpdate(s.bytes, [
    [dss, "<< /Certs [] >>"],
    [s.catalogRef.objectNumber, s.doc.catalog.toString()],
  ]);
  expect((await check(bytes)).sig.later?.validationOnly).toBe(false);
});

// pyHanko 簽出來的檔案（tests/global-setup.ts 產生）：四層驗證都要通過，簽完之後加上的 /DSS 與文件時間戳記不算修改
for (const kind of ["lt", "lta"] as const) {
  test(`pyHanko 的 PAdES B-${kind.toUpperCase()}`, async () => {
    test.skip(!existsSync(PADES[kind]), "沒有 pyHanko 產生的測試檔");
    const bytes = new Uint8Array(readFileSync(PADES[kind]));
    const ev = await examine(bytes, "pdf");
    expect(ev.dss?.crls).toHaveLength(1);
    const trust = { roots: [new Uint8Array(readFileSync(PADES.root))], intermediates: [] };
    const [sig, stamp] = ev.signatures;
    const result = await verifyPdfSignature(bytes, { byteRange: sig!.byteRange!, contents: sig!.contents!, dss: ev.dss }, trust);
    expect(result).toMatchObject({ kind: "signature", integrity: "intact", signature: "valid", chain: "trusted", revocation: { status: "good", source: "crl" } });
    expect(result.timestamp).toMatchObject({ imprint: "match", signature: "valid", chain: "trusted" });
    if (kind === "lta") {
      expect(stamp!.subFilter).toBe("ETSI.RFC3161");
      const doc = await verifyPdfSignature(bytes, { byteRange: stamp!.byteRange!, contents: stamp!.contents!, dss: ev.dss }, trust);
      expect(doc).toMatchObject({ kind: "document", integrity: "intact", signature: "valid", chain: "trusted" });
    }
    for (const s of ev.signatures) expect(s.later?.validationOnly).toBe(true);
    expect(summarize([{ index: 1, name: "a.pdf", format: "pdf", size: bytes.length, evidence: ev }]).warnings.map((w) => w.code)).not.toContain("signed-then-modified");
  });
}

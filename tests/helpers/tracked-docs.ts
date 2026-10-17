import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { writeZip } from "../../src/core/zip.ts";

// 文件開啟前檢查的測試檔：在各種地方埋了打開時會連到外面、執行程式的內容。
// 網域一律用 example.*，網路芳鄰的主機名稱也是假的。

const enc = new TextEncoder();
const xml = (text: string) => enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${text}`);
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const zip = (files: Record<string, Uint8Array>) => writeZip(Object.entries(files).map(([name, data]) => ({ name, data, compress: true })));

// 遠端範本、外部圖片、INCLUDEPICTURE 欄位（指令拆成兩段）、網路芳鄰的範本、連結、巨集、內嵌物件
export async function trackedDocx(): Promise<Uint8Array> {
  return zip({
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": xml(`<Relationships ${RELS}><Relationship Id="rId1" Type="${T}/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": xml(
      `<w:document ${W}><w:body><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> INCLUDEPICTURE "http://pixel.example.com/</w:instrText></w:r><w:r><w:instrText>open.png?id=42" \\d </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>VISIBLE</w:t></w:r></w:p></w:body></w:document>`,
    ),
    "word/_rels/document.xml.rels": xml(
      `<Relationships ${RELS}>` +
        `<Relationship Id="rId2" Type="${T}/image" Target="https://img.example.com/logo.png" TargetMode="External"/>` +
        `<Relationship Id="rId3" Type="${T}/hyperlink" Target="https://news.example.org/story" TargetMode="External"/>` +
        `<Relationship Id="rId4" Type="${T}/oleObject" Target="../embeddings/oleObject1.bin"/>` +
        "</Relationships>",
    ),
    "word/settings.xml": xml(`<w:settings ${W}><w:attachedTemplate r:id="rId1" xmlns:r="${T}"/></w:settings>`),
    "word/_rels/settings.xml.rels": xml(
      `<Relationships ${RELS}><Relationship Id="rId1" Type="${T}/attachedTemplate" Target="https://tracker.example.net/template.dotx" TargetMode="External"/>` +
        `<Relationship Id="rId9" Type="${T}/frame" Target="\\\\fileserver.example\\share\\frame.html" TargetMode="External"/></Relationships>`,
    ),
    "word/vbaProject.bin": enc.encode("VBA-MACRO"),
    "word/embeddings/oleObject1.bin": enc.encode("OLE"),
  });
}

// DDE 欄位與 Excel 的網頁查詢連線
export async function trackedXlsx(): Promise<Uint8Array> {
  return zip({
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
    "_rels/.rels": xml(`<Relationships ${RELS}><Relationship Id="rId1" Type="${T}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'),
    "xl/connections.xml": xml(
      '<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><connection id="1" name="q"><webPr url="https://data.example.com/feed.csv"/></connection></connections>',
    ),
  });
}

export async function trackedOdt(): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    mimetype: enc.encode("application/vnd.oasis.opendocument.text"),
    "META-INF/manifest.xml": xml(
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>',
    ),
    "content.xml": xml(
      '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0">' +
        '<office:scripts><office:event-listeners><script:event-listener script:language="ooo:script" script:event-name="dom:load" xlink:href="vnd.sun.star.script:Standard.Module1.Main?language=Basic&amp;location=document"/></office:event-listeners></office:scripts>' +
        '<office:body><office:text><text:p><draw:frame><draw:image xlink:href="https://beacon.example.com/i.png"/></draw:frame><text:a xlink:href="https://site.example.org/">VISIBLE</text:a></text:p></office:text></office:body></office:document-content>',
    ),
    "Basic/Standard/Module1.xml": xml("<script:module/>"),
  };
  return writeZip(Object.entries(files).map(([name, data]) => ({ name, data, compress: name !== "mimetype" })));
}

// 打開時開啟網址、文件層級的 JavaScript（裡面有網址）、連結註解、開啟其他程式、內嵌的檔案
export async function trackedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText("VISIBLE", { x: 20, y: 200, size: 18, font });
  const ctx = doc.context;
  doc.catalog.set(PDFName.of("OpenAction"), ctx.obj({ S: "URI", URI: PDFString.of("https://open.example.com/hello") }));
  const js = ctx.register(ctx.obj({ S: "JavaScript", JS: PDFString.of('this.submitForm("https://collect.example.com/opened");') }));
  doc.catalog.set(PDFName.of("Names"), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of("init"), js] }) }));
  const link = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 100, 40], A: ctx.obj({ S: "URI", URI: PDFString.of("https://read.example.org/more") }) }),
  );
  const launch = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 50, 100, 80], A: ctx.obj({ S: "Launch", F: PDFString.of("calc.exe") }) }));
  const attach = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [10, 90, 30, 110], FS: ctx.obj({ Type: "Filespec", F: PDFString.of("invoice.exe"), UF: PDFString.of("invoice.exe") }) }),
  );
  page.node.set(PDFName.of("Annots"), ctx.obj([link, launch, attach]));
  return doc.save({ useObjectStreams: false });
}

export async function cleanPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 300]).drawText("VISIBLE", { x: 20, y: 200, size: 18, font });
  return doc.save();
}

export const TRACKED_HTML = `<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/a.css"><style>body{background:url('https://bg.example.com/x.png')}</style></head>
<body><img src="https://pixel.example.com/t.gif?u=1" width="1" height="1"><script src="https://js.example.com/s.js"></script>
<a href="https://site.example.org/page">VISIBLE</a><img src="local.png"></body></html>`;

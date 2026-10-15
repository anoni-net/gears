import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { writeZip } from "../../src/core/zip.ts";
import { syntheticJpeg, syntheticPng } from "./fixtures.ts";

// 文件格式的測試檔：結構完整、在各處都塞了秘密字串的 docx、xlsx、pptx、odt。
// 真實的檔案在本機用 python-docx、openpyxl、python-pptx 與 LibreOffice 產生來驗證，不進 repo。

const enc = new TextEncoder();
const xml = (text: string) => enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${text}`);

// 清除後任何一個都不能留在檔案裡
export const DOC_SECRETS = [
  "Jane Doe",
  "SECRET-MODIFIER",
  "SECRET-COMPANY",
  "SECRET-TITLE",
  "SECRET-CUSTOM",
  "janedoe",
  "SECRET-PRINTER",
  "00AB12CD",
  "SECRET-REVIEWER",
  "SECRET-EDITOR",
  "2024-06-01T10",
  "reviewer@example.org",
  "SECRET-DOCID",
  "SECRET-MODEL", // 內嵌照片的 EXIF
  "SECRET-COMMENT",
];

// 清除後一定要還在的內文
export const VISIBLE = "VISIBLE-BODY";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CORE = xml(
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>SECRET-TITLE</dc:title><dc:creator>Jane Doe</dc:creator><cp:lastModifiedBy>SECRET-MODIFIER</cp:lastModifiedBy>" +
    '<dcterms:created xsi:type="dcterms:W3CDTF">2024-06-01T10:00:00Z</dcterms:created></cp:coreProperties>',
);
const APP = xml(
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Company>SECRET-COMPANY</Company><TotalTime>42</TotalTime></Properties>',
);
const CUSTOM = xml(
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="Owner" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2"><vt:lpwstr>SECRET-CUSTOM</vt:lpwstr></property></Properties>',
);

// Windows 的 DEVMODE：開頭是 32 個 UTF-16 字元的印表機名稱
export function devmode(name: string): Uint8Array {
  const out = new Uint8Array(220);
  for (let i = 0; i < name.length; i++) out[i * 2] = name.charCodeAt(i);
  return out;
}

function types(overrides: [string, string][]) {
  return xml(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
      overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("") +
      "</Types>",
  );
}

const rels = (items: string[]) => xml(`<Relationships ${RELS}>${items.join("")}</Relationships>`);
const rootRels = (main: string) =>
  rels([
    `<Relationship Id="rId1" Type="${T}/officeDocument" Target="${main}"/>`,
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    `<Relationship Id="rId3" Type="${T}/extended-properties" Target="docProps/app.xml"/>`,
    `<Relationship Id="rId4" Type="${T}/custom-properties" Target="docProps/custom.xml"/>`,
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>',
  ]);

const commonParts = (main: string) => [
  { name: "_rels/.rels", data: rootRels(main) },
  { name: "docProps/core.xml", data: CORE },
  { name: "docProps/app.xml", data: APP },
  { name: "docProps/custom.xml", data: CUSTOM },
  { name: "docProps/thumbnail.jpeg", data: syntheticJpeg() },
];

const commonTypes: [string, string][] = [
  ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
  ["/docProps/app.xml", "application/vnd.openxmlformats-officedocument.extended-properties+xml"],
  ["/docProps/custom.xml", "application/vnd.openxmlformats-officedocument.custom-properties+xml"],
];

const pack = (parts: { name: string; data: Uint8Array }[]) => writeZip(parts.map((p) => ({ ...p, compress: true })));

export async function syntheticDocx(embedded?: Uint8Array): Promise<Uint8Array> {
  const document = xml(
    `<w:document ${W} ${R} xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>` +
      `<w:p w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD" w14:paraId="1A2B3C4D"><w:r w:rsidRPr="00AB12CD"><w:t>${VISIBLE}</w:t></w:r>` +
      '<w:commentRangeStart w:id="0"/><w:r><w:t>commented</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
      '<w:p><w:ins w:id="1" w:author="SECRET-EDITOR" w:date="2024-06-01T10:00:00Z"><w:r><w:t>inserted</w:t></w:r></w:ins>' +
      '<w:del w:id="2" w:author="SECRET-EDITOR" w:date="2024-06-01T10:00:00Z" w16du:dateUtc="2024-06-01T10:00:00Z" xmlns:w16du="http://schemas.microsoft.com/office/word/2023/wordml/word16du"><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>' +
      '<w:p><w:hyperlink r:id="rId7"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rId5"/></w:drawing></w:r></w:p>' +
      '<w:sectPr w:rsidR="00AB12CD"/></w:body></w:document>',
  );
  const documentRels = rels([
    `<Relationship Id="rId2" Type="${T}/comments" Target="comments.xml"/>`,
    '<Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/>',
    `<Relationship Id="rId4" Type="${T}/settings" Target="settings.xml"/>`,
    `<Relationship Id="rId5" Type="${T}/image" Target="media/image1.jpeg"/>`,
    `<Relationship Id="rId6" Type="${T}/customXml" Target="../customXml/item1.xml"/>`,
    `<Relationship Id="rId7" Type="${T}/hyperlink" Target="file:///C:/Users/janedoe/Documents/plan.docx" TargetMode="External"/>`,
    `<Relationship Id="rId8" Type="${T}/hyperlink" Target="https://anoni.net/" TargetMode="External"/>`,
    `<Relationship Id="rId9" Type="${T}/oleObject" Target="embeddings/oleObject1.bin"/>`,
    ...(embedded ? [`<Relationship Id="rId10" Type="${T}/package" Target="embeddings/inner.docx"/>`] : []),
  ]);
  const comments = xml(
    `<w:comments ${W}><w:comment w:id="0" w:author="SECRET-REVIEWER" w:date="2024-06-01T10:00:00Z" w:initials="SR"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`,
  );
  const people = xml(
    '<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="SECRET-REVIEWER"><w15:presenceInfo w15:providerId="AD" w15:userId="reviewer@example.org"/></w15:person></w15:people>',
  );
  const settings = xml(
    `<w:settings ${W} ${R} xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w:zoom w:percent="100"/><w:attachedTemplate r:id="rId1"/>` +
      '<w:docVars><w:docVar w:name="owner" w:val="Jane Doe"/></w:docVars>' +
      '<w:rsids><w:rsidRoot w:val="00AB12CD"/><w:rsid w:val="00AB12CD"/></w:rsids><w15:docId w15:val="{SECRET-DOCID}"/></w:settings>',
  );
  const settingsRels = rels([
    `<Relationship Id="rId1" Type="${T}/attachedTemplate" Target="file:///C:\\Users\\janedoe\\Templates\\Normal.dotm" TargetMode="External"/>`,
  ]);
  const styles = xml(`<w:styles ${W}><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rsid w:val="00AB12CD"/></w:style></w:styles>`);
  return pack([
    {
      name: "[Content_Types].xml",
      data: types([
        ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
        ["/word/comments.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"],
        ["/word/people.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"],
        ["/word/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"],
        ["/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"],
        ["/customXml/itemProps1.xml", "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"],
        ...commonTypes,
      ]),
    },
    ...commonParts("word/document.xml"),
    { name: "word/document.xml", data: document },
    { name: "word/_rels/document.xml.rels", data: documentRels },
    { name: "word/comments.xml", data: comments },
    { name: "word/people.xml", data: people },
    { name: "word/settings.xml", data: settings },
    { name: "word/_rels/settings.xml.rels", data: settingsRels },
    { name: "word/styles.xml", data: styles },
    { name: "word/media/image1.jpeg", data: syntheticJpeg() },
    { name: "word/embeddings/oleObject1.bin", data: enc.encode("OLE-OBJECT-DATA") },
    ...(embedded ? [{ name: "word/embeddings/inner.docx", data: embedded }] : []),
    { name: "customXml/item1.xml", data: xml("<root>SECRET-CUSTOM</root>") },
    { name: "customXml/itemProps1.xml", data: xml('<ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml" ds:itemID="{SECRET-DOCID}"/>') },
    { name: "customXml/_rels/item1.xml.rels", data: rels([`<Relationship Id="rId1" Type="${T}/customXmlProps" Target="itemProps1.xml"/>`]) },
  ]);
}

const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

export async function syntheticXlsx(): Promise<Uint8Array> {
  const workbook = xml(
    `<workbook ${X} ${R} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision">` +
      '<fileSharing userName="Jane Doe"/>' +
      '<mc:AlternateContent><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\janedoe\\Documents\\"/></mc:Choice></mc:AlternateContent>' +
      '<xr:revisionPtr revIDLastSave="0" documentId="8_{SECRET-DOCID}"/>' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  const sheet = xml(
    `<worksheet ${X} ${R}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${VISIBLE}</t></is></c></row></sheetData><pageSetup orientation="portrait" r:id="rId1"/></worksheet>`,
  );
  const comments = xml(
    `<comments ${X}><authors><author>SECRET-REVIEWER</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>SECRET-REVIEWER:</t></r><r><t xml:space="preserve">\nnote</t></r></text></comment></commentList></comments>`,
  );
  return pack([
    {
      name: "[Content_Types].xml",
      data: types([
        ["/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
        ["/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"],
        ["/xl/comments1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"],
        ["/xl/printerSettings/printerSettings1.bin", "application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"],
        ...commonTypes,
      ]),
    },
    ...commonParts("xl/workbook.xml"),
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: rels([`<Relationship Id="rId1" Type="${T}/worksheet" Target="worksheets/sheet1.xml"/>`]) },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
    {
      name: "xl/worksheets/_rels/sheet1.xml.rels",
      data: rels([
        `<Relationship Id="rId1" Type="${T}/printerSettings" Target="../printerSettings/printerSettings1.bin"/>`,
        `<Relationship Id="rId2" Type="${T}/comments" Target="../comments1.xml"/>`,
      ]),
    },
    { name: "xl/comments1.xml", data: comments },
    { name: "xl/printerSettings/printerSettings1.bin", data: devmode("SECRET-PRINTER") },
  ]);
}

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

export async function syntheticPptx(): Promise<Uint8Array> {
  return pack([
    {
      name: "[Content_Types].xml",
      data: types([
        ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
        ["/ppt/slides/slide1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"],
        ["/ppt/commentAuthors.xml", "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"],
        ["/ppt/comments/comment1.xml", "application/vnd.openxmlformats-officedocument.presentationml.comments+xml"],
        ...commonTypes,
      ]),
    },
    ...commonParts("ppt/presentation.xml"),
    { name: "ppt/presentation.xml", data: xml(`<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`) },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: rels([
        `<Relationship Id="rId2" Type="${T}/slide" Target="slides/slide1.xml"/>`,
        `<Relationship Id="rId3" Type="${T}/commentAuthors" Target="commentAuthors.xml"/>`,
      ]),
    },
    { name: "ppt/slides/slide1.xml", data: xml(`<p:sld ${P}><p:cSld><p:spTree><a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${VISIBLE}</a:t></p:spTree></p:cSld></p:sld>`) },
    { name: "ppt/slides/_rels/slide1.xml.rels", data: rels([`<Relationship Id="rId1" Type="${T}/comments" Target="../comments/comment1.xml"/>`]) },
    {
      name: "ppt/commentAuthors.xml",
      data: xml(
        `<p:cmAuthorLst ${P} xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"><p:cmAuthor id="0" name="SECRET-REVIEWER" initials="SR" lastIdx="1" clrIdx="0"><p:extLst><p:ext uri="{19B8F6BF-5375-455C-9EA6-DF929625EA0E}"><p15:presenceInfo userId="reviewer@example.org" providerId="AD"/></p:ext></p:extLst></p:cmAuthor></p:cmAuthorLst>`,
      ),
    },
    { name: "ppt/comments/comment1.xml", data: xml(`<p:cmLst ${P}><p:cm authorId="0" dt="2024-06-01T10:00:00.000" idx="1"><p:text>note</p:text></p:cm></p:cmLst>`) },
  ]);
}

const ODF_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:officeooo="http://openoffice.org/2009/office" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';

export async function syntheticOdt(opts: { encrypted?: boolean } = {}): Promise<Uint8Array> {
  const manifest = xml(
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
      ["content.xml", "styles.xml", "meta.xml", "settings.xml", "Pictures/1.jpg", "Thumbnails/thumbnail.png"]
        .map(
          (path) =>
            `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml">${
              opts.encrypted && path === "content.xml" ? '<manifest:encryption-data manifest:checksum-type="SHA1/1K"/>' : ""
            }</manifest:file-entry>`,
        )
        .join("") +
      "</manifest:manifest>",
  );
  const meta = xml(
    `<office:document-meta ${ODF_NS} office:version="1.3"><office:meta><meta:initial-creator>Jane Doe</meta:initial-creator><dc:creator>SECRET-MODIFIER</dc:creator>` +
      '<meta:creation-date>2024-06-01T10:00:00</meta:creation-date><dc:title>SECRET-TITLE</dc:title><meta:generator>LibreOffice/26.2</meta:generator>' +
      '<meta:template xlink:type="simple" xlink:href="file:///C:/Users/janedoe/Templates/plan.ott"/><meta:user-defined meta:name="Owner">SECRET-CUSTOM</meta:user-defined>' +
      "</office:meta></office:document-meta>",
  );
  const settings = xml(
    `<office:document-settings ${ODF_NS}><office:settings><config:config-item-set config:name="ooo:configuration-settings">` +
      '<config:config-item config:name="PrinterName" config:type="string">SECRET-PRINTER</config:config-item>' +
      '<config:config-item config:name="PrinterSetup" config:type="base64Binary">U0VDUkVULVBSSU5URVI=</config:config-item>' +
      '<config:config-item config:name="RsidRoot" config:type="int">11211213</config:config-item>' +
      '<config:config-item config:name="AddParaTableSpacing" config:type="boolean">true</config:config-item>' +
      "</config:config-item-set></office:settings></office:document-settings>",
  );
  const content = xml(
    `<office:document-content ${ODF_NS}><office:automatic-styles><style:style style:name="P1"><style:text-properties officeooo:rsid="00AB12CD" officeooo:paragraph-rsid="00AB12CD"/></style:style></office:automatic-styles>` +
      "<office:body><office:text><text:tracked-changes><text:changed-region text:id=\"ct1\"><text:insertion><office:change-info><dc:creator>SECRET-EDITOR</dc:creator><dc:date>2024-06-01T10:00:00</dc:date></office:change-info></text:insertion></text:changed-region></text:tracked-changes>" +
      `<text:p text:style-name="P1">${VISIBLE}<office:annotation><dc:creator>SECRET-REVIEWER</dc:creator><dc:date>2024-06-01T10:00:00</dc:date><meta:creator-initials>SR</meta:creator-initials><text:p>SECRET-REVIEWER: note</text:p></office:annotation></text:p>` +
      "</office:text></office:body></office:document-content>",
  );
  return writeZip([
    { name: "mimetype", data: enc.encode("application/vnd.oasis.opendocument.text"), compress: false },
    { name: "content.xml", data: content, compress: true },
    { name: "styles.xml", data: xml(`<office:document-styles ${ODF_NS}/>`), compress: true },
    { name: "meta.xml", data: meta, compress: true },
    { name: "settings.xml", data: settings, compress: true },
    { name: "Pictures/1.jpg", data: syntheticJpeg(), compress: false },
    { name: "Thumbnails/thumbnail.png", data: syntheticPng(), compress: false },
    { name: "META-INF/documentsignatures.xml", data: xml("<signatures>Jane Doe</signatures>"), compress: true },
    { name: "META-INF/manifest.xml", data: manifest, compress: true },
  ]);
}

// PDF：文件資訊、XMP、PieceInfo、識別碼、標記註解、表單欄位、內嵌 JPEG，加上一個沒有被引用的舊物件
export async function syntheticPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setAuthor("Jane Doe");
  doc.setTitle("SECRET-TITLE");
  doc.setCreator("SECRET-COMPANY Writer");
  doc.setCreationDate(new Date("2024-06-01T10:00:00Z"));
  const page = doc.addPage([200, 200]);
  page.drawText(VISIBLE, { x: 10, y: 150, font: await doc.embedFont(StandardFonts.Helvetica), size: 10 });
  const image = await doc.embedJpg(syntheticJpeg({ trailer: false }));
  page.drawImage(image, { x: 10, y: 10, width: 20, height: 20 });
  const { context } = doc;
  doc.catalog.set(PDFName.of("Metadata"), context.register(context.stream("<x:xmpmeta>SECRET-CUSTOM</x:xmpmeta>", { Type: "Metadata", Subtype: "XML" })));
  page.node.set(PDFName.of("PieceInfo"), context.obj({ App: { Private: PDFString.of("SECRET-CUSTOM") } }));
  const note = context.register(
    context.obj({ Type: "Annot", Subtype: "Text", Rect: [0, 0, 10, 10], T: PDFString.of("SECRET-REVIEWER"), M: PDFString.of("D:20240601100000Z"), Contents: PDFString.of("note") }),
  );
  const field = context.register(context.obj({ Type: "Annot", Subtype: "Widget", Rect: [0, 0, 10, 10], FT: "Tx", T: PDFString.of("FIELD-NAME") }));
  page.node.set(PDFName.of("Annots"), context.obj([note, field]));
  // 沒有任何地方引用的物件，模擬修改之前留下的舊版本
  context.register(context.obj({ Old: PDFString.of("SECRET-MODIFIER") }));
  context.trailerInfo.ID = context.obj([PDFHexString.of("5345435245542d4943"), PDFHexString.of("5345435245542d4943")]);
  return doc.save({ useObjectStreams: false });
}

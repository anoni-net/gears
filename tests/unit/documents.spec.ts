import { expect, test } from "@playwright/test";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { CONTENT_FINDINGS, ToolError } from "../../src/core/tool.ts";
import { rewriteXml, unescapeXml } from "../../src/core/xml.ts";
import { entryData, readZip, writeZip } from "../../src/core/zip.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { basename, isLocalPath } from "../../src/tools/strip-metadata/package.ts";
import { DOC_SECRETS, VISIBLE, syntheticDocx, syntheticOdt, syntheticPdf, syntheticPptx, syntheticXlsx } from "../helpers/documents.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

// zip 裡每個檔案解壓縮之後接起來，用來找秘密字串
async function unpack(data: Uint8Array): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of readZip(data).entries) files.set(entry.name, dec.decode(await entryData(data, entry)));
  return files;
}

const leaks = (text: string) => DOC_SECRETS.filter((s) => text.includes(s));

test.describe("zip", () => {
  test("寫出的檔案讀得回來，時間戳記統一、沒有附加欄位", async () => {
    const files = [
      { name: "mimetype", data: enc.encode("application/vnd.oasis.opendocument.text"), compress: false },
      { name: "目錄/中文.xml", data: enc.encode("<a>" + "重複的內容".repeat(200) + "</a>"), compress: true },
    ];
    const zip = await writeZip(files);
    const { entries } = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["mimetype", "目錄/中文.xml"]);
    expect(entries.map((e) => e.method)).toEqual([0, 8]);
    expect(entries.every((e) => e.extraLength === 0 && e.commentLength === 0)).toBe(true);
    for (const [i, entry] of entries.entries()) expect(await entryData(zip, entry)).toEqual(files[i]!.data);
    // 本機檔頭的日期欄位：1980-01-01
    const view = new DataView(zip.buffer, zip.byteOffset);
    expect(view.getUint16(10, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe(0x21);
    // ODF 規定 mimetype 從第 38 個位元組開始，沒有壓縮
    expect(dec.decode(zip.subarray(38, 38 + 39))).toBe("application/vnd.oasis.opendocument.text");
  });

  test("內容與 CRC 對不上就停下來", async () => {
    const zip = await writeZip([{ name: "a.txt", data: enc.encode("hello"), compress: false }]);
    zip[30 + 5] = "j".charCodeAt(0);
    await expect(entryData(zip, readZip(zip).entries[0]!)).rejects.toThrow(ToolError);
  });

  test("加密的 zip 不處理", async () => {
    const zip = await writeZip([{ name: "a.txt", data: enc.encode("hello"), compress: false }]);
    const cd = zip.length - 22 - 46 - 5;
    zip[cd + 8] = 1;
    expect(() => readZip(zip)).toThrow(ToolError);
  });
});

test.describe("xml", () => {
  test("依命名空間改寫，前綴換了也認得", () => {
    const source =
      '<?xml version="1.0"?>\n<doc xmlns:a="urn:x"><a:keep a:rsid="1" other="2">text &amp; more</a:keep><!--note--><a:drop><a:inner/></a:drop><b:x xmlns:b="urn:x" b:rsid="3"/></doc>';
    const result = rewriteXml(source, {
      dropElement: (el) => el.ns === "urn:x" && el.local === "drop",
      attr: (a) => (a.ns === "urn:x" && a.local === "rsid" ? null : undefined),
      text: (text) => (text === "text & more" ? 'new <"value">' : undefined),
    });
    expect(result.text).toBe(
      '<?xml version="1.0"?>\n<doc xmlns:a="urn:x"><a:keep other="2">new &lt;&quot;value&quot;&gt;</a:keep><b:x xmlns:b="urn:x"/></doc>',
    );
    expect(result).toMatchObject({ elements: 1, attributes: 2, texts: 1, comments: 1 });
  });

  test("標籤沒有對上就停下來", () => {
    expect(() => rewriteXml("<a><b></a></b>", {})).toThrow(ToolError);
    expect(() => rewriteXml("<a><b>", {})).toThrow(ToolError);
  });

  test("解開字元參照", () => {
    expect(unescapeXml("&#x4E2D;&#25991;&lt;&apos;")).toBe("中文<'");
  });
});

test("電腦上的路徑只留檔名，網址不動", () => {
  expect(isLocalPath("file:///C:/Users/janedoe/a.docx")).toBe(true);
  expect(isLocalPath("C:\\Users\\janedoe\\a.xlsx")).toBe(true);
  expect(isLocalPath("\\\\server\\share\\a.xlsx")).toBe(true);
  expect(isLocalPath("../Documents/a.xlsx")).toBe(true);
  expect(isLocalPath("https://anoni.net/a")).toBe(false);
  expect(isLocalPath("mailto:a@example.org")).toBe(false);
  expect(isLocalPath("#bookmark")).toBe(false);
  expect(basename("file:///C:/Users/jane%20doe/my%20plan.docx")).toBe("my plan.docx");
  expect(basename("C:\\Users\\janedoe\\Templates\\Normal.dotm")).toBe("Normal.dotm");
});

// Office 套件內部要前後一致：每個 Override 指到的部件都在，每個內部關聯的目標都在
function checkPackage(files: Map<string, string>) {
  for (const m of files.get("[Content_Types].xml")!.matchAll(/PartName="\/([^"]+)"/g)) expect(files.has(m[1]!), m[1]).toBe(true);
  for (const [name, text] of files) {
    const rels = /^(.*?)_rels\/([^/]*)\.rels$/.exec(name);
    if (!rels) continue;
    for (const m of text.matchAll(/<Relationship ([^>]*)\/>/g)) {
      if (/TargetMode="External"/.test(m[1]!)) continue;
      const target = /Target="([^"]+)"/.exec(m[1]!)![1]!;
      const path = new URL(target, `http://x/${rels[1]}${rels[2]}`).pathname.slice(1);
      expect(files.has(path), `${name} → ${target}`).toBe(true);
    }
  }
}

const officeCases: { name: string; file: () => Promise<Uint8Array>; format: Format; content: string[] }[] = [
  { name: "docx", file: () => syntheticDocx(), format: "docx", content: ["doc-comments", "revisions", "attachments"] },
  { name: "xlsx", file: syntheticXlsx, format: "xlsx", content: ["doc-comments"] },
  { name: "pptx", file: syntheticPptx, format: "pptx", content: ["doc-comments"] },
  { name: "odt", file: () => syntheticOdt(), format: "odt", content: ["doc-comments", "revisions"] },
];

for (const c of officeCases) {
  test(`${c.name}：秘密字串全部拿掉，內文還在`, async () => {
    const input = await c.file();
    expect(sniff(input)).toBe(c.format);
    const before = await stripMetadata.inspect(input, c.format);
    const codes = before.map((f) => f.code);
    expect(codes).toContain("owner");
    expect(before.find((f) => f.code === "owner")!.value).toMatch(/Jane Doe/);
    for (const code of c.content) expect(codes).toContain(code);

    const { data, report } = await stripMetadata.run(input, c.format);
    expect(sniff(data)).toBe(c.format);
    expect(report.removed.map((r) => r.code)).toEqual(expect.arrayContaining(["doc-properties", "doc-authors", "doc-thumbnail"]));
    const files = await unpack(data);
    const all = [...files.values()].join("\n");
    expect(leaks(all)).toEqual([]);
    expect(all).toContain(VISIBLE);
    if (c.format !== "odt") checkPackage(files);

    // 清除後只剩下內容類的提醒，工具列不會再把清除中繼資料標成建議
    const after = await stripMetadata.inspect(data, c.format);
    expect(after.map((f) => f.code).sort()).toEqual([...c.content].sort());
    expect(after.every((f) => CONTENT_FINDINGS.includes(f.code))).toBe(true);
    expect(after.some((f) => stripMetadata.resolves.includes(f.code))).toBe(false);
  });
}

test("docx：外部連結只留檔名，網址照舊，範本與內嵌照片處理掉", async () => {
  const { data } = await stripMetadata.run(await syntheticDocx(), "docx");
  const files = await unpack(data);
  const rels = files.get("word/_rels/document.xml.rels")!;
  expect(rels).toContain('Target="plan.docx"');
  expect(rels).toContain('Target="https://anoni.net/"');
  expect(rels).not.toContain("customXml");
  expect(files.get("word/_rels/settings.xml.rels")).not.toContain("attachedTemplate");
  expect(files.get("word/settings.xml")).not.toContain("attachedTemplate");
  expect(files.get("word/settings.xml")).toContain("w:zoom");
  expect([...files.keys()].filter((n) => /customXml|people|thumbnail|custom\.xml/.test(n))).toEqual([]);
  // 註解與修訂保留，作者改成中性的名字
  expect(files.get("word/comments.xml")).toContain('w:author="Author"');
  expect(files.get("word/document.xml")).toContain('<w:del w:id="2" w:author="Author"');
  expect(files.get("word/document.xml")).toContain("removed");
});

test("xlsx：印表機設定拿掉，指向它的 r:id 一併拿掉，註解開頭的作者名字換掉", async () => {
  const input = await syntheticXlsx();
  const printer = (await stripMetadata.inspect(input, "xlsx")).find((f) => f.code === "printer");
  expect(printer?.value).toBe("SECRET-PRINTER");
  const files = await unpack((await stripMetadata.run(input, "xlsx")).data);
  expect(files.get("xl/worksheets/sheet1.xml")).toContain('<pageSetup orientation="portrait"/>');
  expect(files.get("xl/comments1.xml")).toContain("<t>Author:</t>");
  expect(files.get("xl/workbook.xml")).not.toContain("absPath");
  expect(files.get("xl/workbook.xml")).toContain('<fileSharing userName="Author"/>');
});

test("odt：mimetype 仍在第一個且沒有壓縮，manifest 跟著更新，版面設定保留", async () => {
  const { data } = await stripMetadata.run(await syntheticOdt(), "odt");
  const { entries } = readZip(data);
  expect(entries[0]).toMatchObject({ name: "mimetype", method: 0 });
  const files = await unpack(data);
  expect(files.has("Thumbnails/thumbnail.png")).toBe(false);
  expect(files.has("META-INF/documentsignatures.xml")).toBe(false);
  expect(files.get("META-INF/manifest.xml")).not.toContain("Thumbnails");
  expect(files.get("meta.xml")).toMatch(/<office:meta><\/office:meta>/);
  expect(files.get("settings.xml")).toContain("AddParaTableSpacing");
  // 追蹤修訂的時間是必填，改成固定的值；註解的時間拿掉
  expect(files.get("content.xml")).toContain("<office:change-info><dc:creator>Author</dc:creator><dc:date>1980-01-01T00:00:00</dc:date>");
  expect(files.get("content.xml")).toContain("<office:annotation><dc:creator>Author</dc:creator><text:p>Author: note</text:p>");
});

test("加密的 odt 不處理", async () => {
  const input = await syntheticOdt({ encrypted: true });
  expect(sniff(input)).toBe("odt");
  await expect(stripMetadata.run(input, "odt")).rejects.toThrow(ToolError);
});

test("內嵌的 Office 文件一起清除，層數太深就停下來", async () => {
  const inner = await syntheticDocx();
  const { data } = await stripMetadata.run(await syntheticDocx(inner), "docx");
  const nested = (await unpack(data)).get("word/embeddings/inner.docx");
  expect(nested).toBeDefined();
  const files = await readZip(data);
  const innerData = await entryData(data, files.entries.find((e) => e.name === "word/embeddings/inner.docx")!);
  expect(leaks([...(await unpack(innerData)).values()].join("\n"))).toEqual([]);

  let deep = await syntheticDocx();
  for (let i = 0; i < 4; i++) deep = await syntheticDocx(deep);
  await expect(stripMetadata.run(deep, "docx")).rejects.toThrow(ToolError);
});

test("有巨集的 Office 文件（docm）不當成 docx", async () => {
  const docm = await writeZip([
    { name: "[Content_Types].xml", data: enc.encode("<Types/>"), compress: true },
    { name: "word/document.xml", data: enc.encode("<w:document/>"), compress: true },
    { name: "word/vbaProject.bin", data: enc.encode("macro"), compress: true },
  ]);
  expect(sniff(docm)).toBe("unknown");
});

test("pdf：文件資訊、XMP、識別碼、註解作者、舊物件與 JPEG 的 EXIF 都拿掉", async () => {
  const input = await syntheticPdf();
  expect(sniff(input)).toBe("pdf");
  const before = await stripMetadata.inspect(input, "pdf");
  expect(before.map((f) => f.code)).toEqual(expect.arrayContaining(["owner", "software", "datetime", "text", "xmp", "other", "device", "doc-comments"]));
  expect(before.find((f) => f.code === "owner")!.value).toMatch(/^Jane Doe、SECRET-REVIEWER$/m);

  const { data, report } = await stripMetadata.run(input, "pdf");
  expect(report.removed.map((r) => r.code)).toEqual(
    expect.arrayContaining(["doc-properties", "doc-ids", "doc-unused", "xmp", "doc-authors", "doc-images"]),
  );
  const text = Buffer.from(data).toString("latin1");
  expect(leaks(text)).toEqual([]);
  expect(text).not.toContain("SECRET-IPTC");
  expect(text).toContain("FIELD-NAME");

  const doc = await PDFDocument.load(data, { updateMetadata: false });
  expect(doc.getPageCount()).toBe(1);
  expect(doc.context.trailerInfo.Info).toBeUndefined();
  const annots = doc.getPage(0).node.Annots()!;
  const note = annots.lookup(0, PDFDict);
  expect(note.lookup(PDFName.of("T"), PDFHexString).decodeText()).toBe("Author");
  expect(note.has(PDFName.of("M"))).toBe(false);
  expect(note.lookup(PDFName.of("Contents"), PDFString).decodeText()).toBe("note");

  const after = await stripMetadata.inspect(data, "pdf");
  expect(after.map((f) => f.code)).toEqual(["doc-comments"]);
});

test("加密的 pdf 不處理", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: "Standard" });
  const input = await doc.save();
  await expect(stripMetadata.run(input, "pdf")).rejects.toThrow(ToolError);
});

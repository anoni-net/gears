import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { type Format } from "../../src/core/bytes.ts";
import { entryData, readZip, writeZip } from "../../src/core/zip.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { VISIBLE, syntheticDocx, syntheticOdt, syntheticPdf, syntheticPptx, syntheticXlsx } from "../helpers/documents.ts";

const dec = new TextDecoder();

async function unpack(data: Uint8Array): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of readZip(data).entries) files.set(entry.name, dec.decode(await entryData(data, entry)));
  return files;
}

const codes = async (data: Uint8Array, format: Format) => (await stripMetadata.inspect(data, format)).map((f) => f.code);

test("預設保留註解與修訂，勾選之後才拿掉", async () => {
  const input = await syntheticDocx();
  const kept = await stripMetadata.run(input, "docx");
  expect(await codes(kept.data, "docx")).toEqual(expect.arrayContaining(["doc-comments", "revisions"]));
  const { data, report } = await stripMetadata.run(input, "docx", { removeComments: true, acceptRevisions: true });
  expect(report.removed.map((r) => r.code)).toEqual(expect.arrayContaining(["doc-comments-removed", "doc-revisions-accepted"]));
  expect(await codes(data, "docx")).not.toContain("doc-comments");
  expect(await codes(data, "docx")).not.toContain("revisions");
});

test("docx：接受修訂留下插入的文字、拿掉刪除的文字，註解的部件與關聯一起拿掉", async () => {
  const { data } = await stripMetadata.run(await syntheticDocx(), "docx", { removeComments: true, acceptRevisions: true });
  const files = await unpack(data);
  const doc = files.get("word/document.xml")!;
  expect(doc).toContain("inserted");
  expect(doc).not.toContain("removed");
  expect(doc).not.toMatch(/<w:(ins|del|commentReference|commentRangeStart)\b/);
  expect(doc).toContain(VISIBLE);
  expect(files.has("word/comments.xml")).toBe(false);
  expect(files.get("word/_rels/document.xml.rels")).not.toContain("comments.xml");
  expect(files.get("[Content_Types].xml")).not.toContain("/word/comments.xml");
});

test("docx：只勾刪除註解時，修訂照樣保留", async () => {
  const { data } = await stripMetadata.run(await syntheticDocx(), "docx", { removeComments: true });
  const doc = (await unpack(data)).get("word/document.xml")!;
  expect(doc).toContain("<w:del ");
  expect(doc).toContain("removed");
});

test("docx：刪除的表格列整列拿掉，插入的表格列留著", async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const row = (text: string, mark: string) => `<w:tr><w:trPr>${mark}</w:trPr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
  const document = `<?xml version="1.0"?><w:document ${W}><w:body><w:tbl>${row("KEEP-ROW", "")}${row("DELETED-ROW", '<w:del w:id="1" w:author="A"/>')}${row("NEW-ROW", '<w:ins w:id="2" w:author="A"/>')}</w:tbl></w:body></w:document>`;
  const enc = new TextEncoder();
  const docx = await writeZip([
    { name: "[Content_Types].xml", data: enc.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), compress: true },
    { name: "_rels/.rels", data: enc.encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'), compress: true },
    { name: "word/document.xml", data: enc.encode(document), compress: true },
  ]);
  const doc = (await unpack((await stripMetadata.run(docx, "docx", { acceptRevisions: true })).data)).get("word/document.xml")!;
  expect(doc).toContain("KEEP-ROW");
  expect(doc).toContain("NEW-ROW");
  expect(doc).not.toContain("DELETED-ROW");
});

test("xlsx 與 pptx：刪除註解，指向註解的關聯一起拿掉", async () => {
  for (const [file, format] of [[await syntheticXlsx(), "xlsx"], [await syntheticPptx(), "pptx"]] as const) {
    const { data } = await stripMetadata.run(file, format, { removeComments: true });
    const files = await unpack(data);
    expect([...files.keys()].filter((n) => /comment/i.test(n))).toEqual([]);
    for (const [name, text] of files) if (name.endsWith(".rels")) expect(text, name).not.toMatch(/comment/i);
    expect(await codes(data, format)).not.toContain("doc-comments");
  }
});

test("odt：刪除註解、接受修訂", async () => {
  const { data } = await stripMetadata.run(await syntheticOdt(), "odt", { removeComments: true, acceptRevisions: true });
  const content = (await unpack(data)).get("content.xml")!;
  expect(content).not.toContain("office:annotation");
  expect(content).not.toContain("text:tracked-changes");
  expect(content).toContain(VISIBLE);
  const left = await codes(data, "odt");
  expect(left).not.toContain("doc-comments");
  expect(left).not.toContain("revisions");
});

test("pdf：刪除標記類的註解，表單欄位留著", async () => {
  const { data } = await stripMetadata.run(await syntheticPdf(), "pdf", { removeComments: true });
  expect(await codes(data, "pdf")).not.toContain("doc-comments");
  const doc = await PDFDocument.load(data);
  expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
  expect(Buffer.from(data).toString("latin1")).toContain("FIELD-NAME");
});

test("內文的個資：拆成好幾個 run 的電話接得起來，刪除的修訂也算，中繼資料與屬性裡的 Email 不算", async () => {
  const { ooxmlText, odfText } = await import("../../src/tools/strip-metadata/body-pii.ts");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  expect(ooxmlText(`<w:document ${W}><w:body><w:p><w:r><w:t>有事打 0912-</w:t></w:r><w:r><w:t>345-678</w:t></w:r></w:p><w:p><w:r><w:t>2024</w:t></w:r></w:p></w:body></w:document>`)).toBe(
    "\n有事打 0912-345-678\n2024",
  );
  const TEXT = 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';
  expect(odfText(`<office:text ${TEXT} xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><text:p>寫信到 <text:span>tips@example.org</text:span></text:p></office:text>`)).toBe(
    "\n寫信到tips@example.org",
  );
  const body = '<w:r><w:t>窗口 0912-</w:t></w:r><w:r><w:t>345-678</w:t></w:r><w:del w:id="9" w:author="x"><w:r><w:delText>舊信箱 old@example.org</w:delText></w:r></w:del>';
  const values = (await stripMetadata.inspect(await syntheticDocx(undefined, body), "docx")).filter((f) => f.code === "body-pii").map((f) => f.value);
  expect(values).toEqual(["0912-345-678\nold@example.org"]);
  // 測試檔的 people.xml 屬性裡有 reviewer@example.org，那是中繼資料，不算內文
  expect((await stripMetadata.inspect(await syntheticDocx(), "docx")).map((f) => f.code)).not.toContain("body-pii");
  // 清除中繼資料不改動內文，清除之後照樣列出
  const { data } = await stripMetadata.run(await syntheticDocx(undefined, body), "docx");
  expect(await codes(data, "docx")).toContain("body-pii");
});

test("內文的個資：Excel、PowerPoint 與 ODF", async () => {
  const xlsx = await syntheticXlsx();
  const pptx = await syntheticPptx();
  const odt = await syntheticOdt();
  // 測試檔本身沒有個資，不應該多出提醒
  for (const [data, format] of [[xlsx, "xlsx"], [pptx, "pptx"], [odt, "odt"]] as const) {
    expect(await codes(data, format), format).not.toContain("body-pii");
  }
  // 把試算表儲存格裡的文字換成一支電話
  const files = readZip(xlsx).entries;
  const out = [];
  for (const entry of files) {
    let bytes = await entryData(xlsx, entry);
    if (entry.name === "xl/worksheets/sheet1.xml") bytes = new TextEncoder().encode(dec.decode(bytes).replace(VISIBLE, "聯絡 02-2963-0188"));
    out.push({ name: entry.name, data: bytes, compress: entry.method === 8 });
  }
  const phone = await writeZip(out);
  expect((await stripMetadata.inspect(phone, "xlsx")).find((f) => f.code === "body-pii")?.value).toBe("02-2963-0188");
});

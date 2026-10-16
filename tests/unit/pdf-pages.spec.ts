import { expect, test } from "@playwright/test";
import { PDFArray, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { ToolError } from "../../src/core/tool.ts";
import { keepPages, pageCount } from "../../src/tools/pdf-pages/index.ts";

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

// 三頁的 PDF，內容串流不壓縮，檔案裡直接看得到每一頁的字。三頁共用掛在頁面樹上的
// Resources，裡面有三張「圖片」，各自只在一頁用到（內容是可以辨認的字串）。
// 第一頁有各種連到第二頁的參照：連結、跳頁動作、註解的 /P、表單欄位的另一個元件。
// 第三頁透過表單 XObject 用到第三張圖片。文件目錄上有作者、書籤與附件。
async function threePages(extra?: (doc: PDFDocument) => void): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  doc.setAuthor("AUTHOR-SECRET");
  const image = (secret: string) =>
    ctx.register(ctx.stream(secret, { Type: "XObject", Subtype: "Image", Width: 1, Height: 1, ColorSpace: "DeviceGray", BitsPerComponent: 8 }));
  const form = ctx.register(ctx.stream("/ImC Do", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 10, 10] }));
  const font = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }));
  const pagesNode = doc.catalog.Pages();
  pagesNode.set(
    PDFName.of("Resources"),
    ctx.obj({ Font: { F1: font }, XObject: { ImA: image("IMAGE-A-SECRET"), ImB: image("IMAGE-B-SECRET"), ImC: image("IMAGE-C-SECRET"), Fm1: form } }),
  );
  const contents = ["/ImA Do BT /F1 12 Tf (PAGE-ONE-TEXT) Tj ET", "/ImB Do BT /F1 12 Tf (PAGE-TWO-SECRET) Tj ET", "/Fm1 Do BT /F1 12 Tf (PAGE-THREE-TEXT) Tj ET"];
  const pages = contents.map((content) => {
    const page = doc.addPage([200, 200]);
    page.node.delete(PDFName.of("Resources")); // 沿用頁面樹上的 Resources
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(content)));
    return page;
  });
  const [first, second] = pages.map((p) => p.ref);

  // 第二頁的表單元件，外觀裡有填好的值
  const appearance = ctx.register(ctx.stream("BT /F1 10 Tf (FIELD-VALUE-PAGE2) Tj ET", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 50, 10] }));
  const widget2 = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", Rect: [0, 0, 50, 10], P: second, AP: { N: appearance } }));
  pages[1]!.node.set(PDFName.of("Annots"), ctx.obj([widget2]));
  const fieldDict = ctx.obj({ FT: "Tx", T: PDFString.of("name"), Kids: [widget2] });
  const field = ctx.register(fieldDict);
  const widget1 = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Widget", Rect: [0, 20, 50, 30], Parent: field, P: first }));
  fieldDict.lookup(PDFName.of("Kids"), PDFArray).push(widget1);

  pages[0]!.node.set(
    PDFName.of("Annots"),
    ctx.obj([
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 40, 10, 50], Dest: [second, "Fit"] })),
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 60, 10, 70], A: { S: "GoTo", D: [second, "Fit"] } })),
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 80, 10, 90], A: { S: "URI", URI: PDFString.of("https://example.org/kept") } })),
      ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [0, 100, 10, 110], P: second, Contents: PDFString.of("NOTE-ON-PAGE-ONE") })),
      widget1,
    ]),
  );
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [field] }));
  doc.catalog.set(PDFName.of("Outlines"), ctx.register(ctx.obj({ Type: "Outlines", Title: PDFString.of("OUTLINE-SECRET"), Dest: [second, "Fit"] })));
  extra?.(doc);
  return doc.save({ useObjectStreams: false });
}

test("只留下第一頁：別頁的內容、圖片、表單的值與整份文件的資料都不在新檔裡", async () => {
  const source = await threePages();
  expect(await pageCount(source)).toBe(3);
  const { data, report } = await keepPages(source, [0]);
  const out = text(data);
  for (const kept of ["PAGE-ONE-TEXT", "IMAGE-A-SECRET", "https://example.org/kept", "NOTE-ON-PAGE-ONE"]) expect(out).toContain(kept);
  for (const gone of ["PAGE-TWO-SECRET", "PAGE-THREE-TEXT", "IMAGE-B-SECRET", "IMAGE-C-SECRET", "FIELD-VALUE-PAGE2", "AUTHOR-SECRET", "OUTLINE-SECRET"]) {
    expect(out).not.toContain(gone);
  }
  expect((await PDFDocument.load(data)).getPageCount()).toBe(1);
  expect(report.removed).toEqual([
    { code: "pdf-pages-removed", count: 2 },
    { code: "pdf-document-level" },
    { code: "pdf-links", count: 2 },
  ]);
  expect(report.kept).toEqual([{ code: "pdf-pages-kept", count: 1 }]);
  // 三頁共用同一個字型
  expect(report.notes).toEqual([{ code: "pdf-fields" }, { code: "pdf-shared-fonts" }]);
});

test("只留下第二頁：第一頁的內容與圖片不在新檔裡", async () => {
  const { data } = await keepPages(await threePages(), [1]);
  const out = text(data);
  expect(out).toContain("PAGE-TWO-SECRET");
  expect(out).toContain("IMAGE-B-SECRET");
  for (const gone of ["PAGE-ONE-TEXT", "IMAGE-A-SECRET", "IMAGE-C-SECRET", "NOTE-ON-PAGE-ONE", "https://example.org/kept"]) expect(out).not.toContain(gone);
});

test("表單 XObject 沿用頁面的資源時，它用到的圖片一起留下", async () => {
  const { data } = await keepPages(await threePages(), [2]);
  const out = text(data);
  expect(out).toContain("PAGE-THREE-TEXT");
  expect(out).toContain("IMAGE-C-SECRET");
  expect(out).not.toContain("IMAGE-A-SECRET");
  expect(out).not.toContain("IMAGE-B-SECRET");
});

test("依原本的順序輸出，重複的頁碼只算一次", async () => {
  const { data, report } = await keepPages(await threePages(), [2, 0, 2]);
  const out = text(data);
  expect(out.indexOf("PAGE-ONE-TEXT")).toBeLessThan(out.indexOf("PAGE-THREE-TEXT"));
  expect((await PDFDocument.load(data)).getPageCount()).toBe(2);
  expect(report.kept).toEqual([{ code: "pdf-pages-kept", count: 2 }]);
});

test("每一頁用自己的字型時，不提醒共用字型", async () => {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  for (const font of ["Helvetica", "Courier"]) {
    const page = doc.addPage([200, 200]);
    page.node.set(PDFName.of("Resources"), ctx.obj({ Font: { F1: ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: font })) } }));
    page.node.set(PDFName.of("Contents"), ctx.register(ctx.stream(`BT /F1 12 Tf (${font}) Tj ET`)));
  }
  const { report } = await keepPages(await doc.save(), [0]);
  expect(report.notes).toEqual([]);
});

test("沒選頁面或頁碼超出範圍時停下來", async () => {
  const source = await threePages();
  await expect(keepPages(source, [])).rejects.toThrow(ToolError);
  await expect(keepPages(source, [3])).rejects.toThrow(ToolError);
  await expect(keepPages(source, [-1])).rejects.toThrow(ToolError);
});

test("其他沒有清掉的參照把別頁帶進來時，檢查會擋下，不交出結果", async () => {
  // 頁面上一個不認得的鍵指向第二頁，複製時第二頁會整頁跟著過來
  const source = await threePages((doc) => doc.getPage(0).node.set(PDFName.of("Custom"), doc.getPage(1).ref));
  await expect(keepPages(source, [0])).rejects.toThrow(ToolError);
});

test("打不開的檔案停下來", async () => {
  await expect(keepPages(new TextEncoder().encode("%PDF-1.7\nbroken"), [0])).rejects.toThrow(ToolError);
});

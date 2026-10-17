import { expect, test } from "@playwright/test";
import { sniff } from "../../src/core/bytes.ts";
import { type CheckItem, checkDocument, groupByHost, remoteTarget, urlsIn } from "../../src/tools/doc-check/index.ts";
import { TRACKED_HTML, cleanPdf, trackedDocx, trackedEmail, trackedOdt, trackedPdf, trackedXlsx } from "../helpers/tracked-docs.ts";

const summary = (items: CheckItem[]) => items.map((i) => `${i.kind} ${i.code}${i.url ? ` ${i.url}` : ""}${i.name ? ` [${i.name}]` : ""}`).sort();

test("Word（docm）：遠端範本、外部圖片與頁框、INCLUDEPICTURE 欄位、巨集、內嵌物件與連結", async () => {
  const bytes = await trackedDocx();
  // 帶著 vbaProject.bin，算成有巨集的 docm
  expect(sniff(bytes)).toBe("docm");
  const { items, partial } = await checkDocument(bytes, "docm");
  expect(partial).toBeUndefined();
  expect(summary(items)).toEqual(
    [
      "connect remote-template https://tracker.example.net/template.dotx",
      "connect remote-image https://img.example.com/logo.png",
      "connect remote-frame \\\\fileserver.example\\share\\frame.html",
      "connect remote-field http://pixel.example.com/open.png?id=42",
      "code macro [word/vbaProject.bin]",
      "embedded embedded-object [oleObject1.bin]",
      "link hyperlink https://news.example.org/story",
    ].sort(),
  );
});

test("Excel：網頁查詢的資料連線", async () => {
  const bytes = await trackedXlsx();
  expect(sniff(bytes)).toBe("xlsx");
  expect(summary((await checkDocument(bytes, "xlsx")).items)).toEqual(["connect remote-data https://data.example.com/feed.csv"]);
});

test("LibreOffice：外部圖片、打開時執行的巨集、連結", async () => {
  const bytes = await trackedOdt();
  expect(sniff(bytes)).toBe("odt");
  const items = summary((await checkDocument(bytes, "odt")).items);
  expect(items).toContain("connect remote-image https://beacon.example.com/i.png");
  expect(items).toContain("link hyperlink https://site.example.org/");
  expect(items).toContain("code macro [Basic/Standard]");
  expect(items.some((i) => i.startsWith("code script-event") && i.includes("dom:load"))).toBe(true);
});

test("PDF：打開時開啟網址、文件層級的 JavaScript、開啟其他程式、內嵌的檔案與連結", async () => {
  const items = summary((await checkDocument(await trackedPdf(), "pdf")).items);
  expect(items).toEqual(
    [
      "connect open-uri https://open.example.com/hello",
      "code javascript [open]",
      "connect remote-other https://collect.example.com/opened",
      "code launch [calc.exe]",
      "embedded embedded-file [invoice.exe]",
      "link hyperlink https://read.example.org/more",
    ].sort(),
  );
});

test("PDF：沒有任何會連線或執行的內容", async () => {
  expect((await checkDocument(await cleanPdf(), "pdf")).items).toEqual([]);
});

test("PDF：讀不了的檔案標成損壞", async () => {
  expect((await checkDocument(new TextEncoder().encode("%PDF-1.7 garbage"), "pdf")).partial).toBe("broken");
});

test("HTML：外部圖片、樣式、script 與 CSS 的 url()，本機的檔案與連結分開", async () => {
  const items = summary((await checkDocument(new TextEncoder().encode(TRACKED_HTML), "html")).items);
  expect(items).toEqual(
    [
      "connect remote-style https://cdn.example.com/a.css",
      "connect remote-style https://bg.example.com/x.png",
      "connect remote-image https://pixel.example.com/t.gif?u=1",
      "code javascript https://js.example.com/s.js",
      "link hyperlink https://site.example.org/page",
    ].sort(),
  );
});

test("網址與網路芳鄰路徑的判斷", () => {
  expect(remoteTarget("https://a.example/x")).toBe("https://a.example/x");
  expect(remoteTarget("//cdn.example/x.js")).toBe("https://cdn.example/x.js");
  expect(remoteTarget("\\\\host\\share")).toBe("\\\\host\\share");
  expect(remoteTarget("mailto:a@example.com")).toBeNull();
  expect(remoteTarget("../media/image1.png")).toBeNull();
  expect(remoteTarget("#bookmark")).toBeNull();
  // Word 欄位指令裡的反斜線是兩個
  expect(urlsIn(String.raw`INCLUDEPICTURE "\\\\evil.example\\share\\a.png" \d`)).toEqual([String.raw`\\evil.example\share\a.png`]);
  expect(urlsIn('this.submitForm("https://collect.example.com/x");')).toEqual(["https://collect.example.com/x"]);
});

test("信件：HTML 內文的外部圖片與樣式另外列出，不算進連結，加上提醒", async () => {
  const { parseEmail } = await import("../../src/tools/email/parse.ts");
  const { assess } = await import("../../src/tools/email/assess.ts");
  const msg = parseEmail(await trackedEmail());
  expect(msg.remote.sort()).toEqual(["https://open.example.net/pixel.gif?r=reader", "https://style.example.org/m.css"]);
  expect(msg.links).toEqual(["https://news.example.org/event"]);
  expect(assess(msg).notes).toContainEqual({ code: "remote-content", value: "2" });
  expect(sniff(msg.attachments[0]!.data)).toBe("docm");
});

test("查證：文件打開時會連線的列在需要留意的地方", async () => {
  const { examine } = await import("../../src/tools/verify/examine.ts");
  const { summarize } = await import("../../src/tools/verify/summary.ts");
  const ev = await examine(await trackedDocx(), "docm");
  expect(ev.docCheck).toEqual({ connect: 4, code: 1 });
  const clean = await examine(await cleanPdf(), "pdf");
  expect(clean.docCheck).toEqual({ connect: 0, code: 0 });
  const summary = summarize([
    { index: 0, name: "invite.docm", format: "docm", size: 1, hash: "a", evidence: ev },
    { index: 1, name: "plain.pdf", format: "pdf", size: 1, hash: "b", evidence: clean },
  ] as never);
  expect(summary.warnings.filter((w) => w.code.startsWith("doc-"))).toEqual([{ code: "doc-connects", files: [0], value: "4" }]);
});

test("同一個連結出現好幾次只列一次，記下次數", async () => {
  const html = `<html><body>${'<a href="https://shop.example.com/sale">買</a>'.repeat(3)}<a href="https://example.org/">首頁</a></body></html>`;
  const result = await checkDocument(new TextEncoder().encode(html), "html");
  const links = result.items.filter((i) => i.kind === "link");
  expect(links).toHaveLength(2);
  expect(links.find((i) => i.url === "https://shop.example.com/sale")?.count).toBe(3);
  expect(links.find((i) => i.url === "https://example.org/")?.count ?? 1).toBe(1);
});

test("連結依網域分組：www. 與大小寫算同一個，依次數排序", () => {
  const groups = groupByHost([
    { kind: "link", code: "hyperlink", url: "https://example.org/a", count: 2 },
    { kind: "link", code: "hyperlink", url: "https://www.Example.org/b" },
    { kind: "link", code: "hyperlink", url: "https://other.example.net/x", count: 5 },
    { kind: "link", code: "hyperlink", url: "https://a.example.com/" },
    { kind: "link", code: "hyperlink", url: "\\\\fileserver\\share\\doc.docx" },
    { kind: "link", code: "hyperlink" },
  ]);
  expect(groups.map((g) => [g.host, g.count])).toEqual([
    ["other.example.net", 5],
    ["example.org", 3],
    ["a.example.com", 1],
    ["fileserver", 1],
  ]);
  expect(groups[1]!.urls).toEqual([
    { url: "https://example.org/a", count: 2 },
    { url: "https://www.Example.org/b", count: 1 },
  ]);
});

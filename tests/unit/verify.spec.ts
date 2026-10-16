import { expect, test } from "@playwright/test";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { writeZip } from "../../src/core/zip.ts";
import { type Evidence, examine } from "../../src/tools/verify/examine.ts";
import { sha256Blob } from "../../src/tools/verify/hash.ts";
import { type CaseFile, extensionMatches, summarize } from "../../src/tools/verify/summary.ts";
import { exifTime, gpsTime, isoTime, pdfTime } from "../../src/tools/verify/times.ts";
import { LAT, LON, buildTiff, exifSegment, insertIntoJpeg, syntheticJpeg } from "../helpers/fixtures.ts";

const enc = new TextEncoder();

test("各種寫法的時間：保留字面與時區，有時區時依 UTC 排序", () => {
  expect(exifTime("2024:06:01 10:00:00", "+08:00")).toEqual({ text: "2024-06-01 10:00:00", offset: "+08:00", sort: Date.UTC(2024, 5, 1, 2) });
  expect(exifTime("2024:06:01 10:00:00")).toEqual({ text: "2024-06-01 10:00:00", offset: undefined, sort: Date.UTC(2024, 5, 1, 10) });
  expect(gpsTime("2024:06:01", [2, 0, 30])).toMatchObject({ text: "2024-06-01 02:00:30", offset: "+00:00" });
  expect(isoTime("2024-06-01T10:00:00.123Z")).toMatchObject({ text: "2024-06-01 10:00:00", offset: "+00:00" });
  expect(isoTime("2024-06-01")).toMatchObject({ text: "2024-06-01 00:00:00", offset: undefined });
  expect(pdfTime("D:20240601100000+08'00'")).toMatchObject({ text: "2024-06-01 10:00:00", offset: "+08:00", sort: Date.UTC(2024, 5, 1, 2) });
  expect(pdfTime("D:20240601100000Z")).toMatchObject({ offset: "+00:00" });
  expect(pdfTime("D:2024")).toMatchObject({ text: "2024-01-01 00:00:00" });
  expect(exifTime("    :  :     :  :  ")).toBeUndefined();
});

// 有拍攝、修改、時區、GPS 時間與縮圖的 EXIF。縮圖的位置在 buildTiff 之後補上
function photo(opts: { gpsHour: number; software?: string; modified?: string }): Uint8Array {
  const tiff = buildTiff({
    ifd0: [
      { tag: 0x010f, type: 2, value: "TestMaker" },
      { tag: 0x0110, type: 2, value: "Phone 15" },
      { tag: 0x0131, type: 2, value: opts.software ?? "17.5" },
      { tag: 0x0132, type: 2, value: opts.modified ?? "2024:06:01 10:05:00" },
    ],
    exif: [
      { tag: 0x9003, type: 2, value: "2024:06:01 10:00:00" },
      { tag: 0x9011, type: 2, value: "+08:00" },
      { tag: 0x9010, type: 2, value: "+08:00" },
      { tag: 0xa431, type: 2, value: "SN-1" },
    ],
    gps: [
      { tag: 0x0001, type: 2, value: "N" },
      { tag: 0x0002, type: 5, value: LAT },
      { tag: 0x0003, type: 2, value: "E" },
      { tag: 0x0004, type: 5, value: LON },
      { tag: 0x0007, type: 5, value: [opts.gpsHour, 1, 0, 1, 0, 1] },
      { tag: 0x001d, type: 2, value: "2024:06:01" },
    ],
    thumbnail: true,
  });
  // 縮圖接在 TIFF 後面，填回 IFD1 的位置與長度
  const thumb = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const out = new Uint8Array(tiff.length + thumb.length);
  out.set(tiff);
  out.set(thumb, tiff.length);
  const view = new DataView(out.buffer);
  const ifd0 = view.getUint32(4);
  const ifd1 = view.getUint32(ifd0 + 2 + view.getUint16(ifd0) * 12);
  for (let i = 0; i < view.getUint16(ifd1); i++) {
    const base = ifd1 + 2 + i * 12;
    if (view.getUint16(base) === 0x0201) view.setUint32(base + 8, tiff.length);
    if (view.getUint16(base) === 0x0202) view.setUint32(base + 8, thumb.length);
  }
  return insertIntoJpeg(syntheticJpeg(), exifSegment(out));
}

test("照片：拍攝、修改與 GPS 時間分開列出，讀出裝置、序號、位置與縮圖", async () => {
  const ev = await examine(photo({ gpsHour: 2 }), "jpeg");
  expect(ev.times.map((t) => [t.kind, t.text, t.offset ?? ""])).toEqual(
    expect.arrayContaining([
      ["taken", "2024-06-01 10:00:00", "+08:00"],
      ["modified", "2024-06-01 10:05:00", "+08:00"],
      ["gps", "2024-06-01 02:00:00", "+00:00"],
    ]),
  );
  expect(ev.devices).toContain("TestMaker Phone 15");
  expect(ev.serials).toEqual(["SN-1"]);
  expect(ev.locations[0]!.lat).toBeCloseTo(25.033, 3);
  expect(ev.thumbnail).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
});

const file = (index: number, name: string, ev: Evidence, extra: Partial<CaseFile> = {}): CaseFile => ({ index, name, format: "jpeg", size: 1, evidence: ev, ...extra });

test("比對：GPS 時間對不上、修改早於拍攝、編輯軟體、副檔名不符、內容相同", async () => {
  const ok = await examine(photo({ gpsHour: 2 }), "jpeg");
  const shifted = await examine(photo({ gpsHour: 7, software: "Adobe Photoshop 25.0", modified: "2024:05:01 09:00:00" }), "jpeg");
  const summary = summarize([
    file(1, "a.jpg", ok, { hash: "same" }),
    file(2, "b.png", shifted, { hash: "other" }),
    file(3, "c.jpeg", ok, { hash: "same" }),
  ]);
  const codes = summary.warnings.map((w) => `${w.code}:${w.files.join(",")}`);
  expect(codes).toContain("duplicate:1,3");
  expect(codes).toContain("extension-mismatch:2");
  expect(codes).toContain("gps-time-mismatch:2");
  expect(codes).toContain("modified-before-created:2");
  expect(codes).toContain("editing-software:2");
  expect(codes.filter((c) => c.endsWith(":1") || c.endsWith(":3"))).toEqual([]);
  // 同一個裝置出現在三個檔案
  expect(summary.devices[0]).toEqual({ value: "TestMaker Phone 15", files: [1, 2, 3] });
  // 時間線依 UTC 排序，第 2 個檔案的修改時間（五月）排最前面
  expect(summary.timeline[0]).toMatchObject({ file: 2, kind: "modified" });
});

test("GPS 時間跟沒有時區的拍攝時間差了整數個時區，不算對不上", () => {
  const ev: Evidence = {
    times: [
      { ...exifTime("2024:06:01 10:00:00")!, kind: "taken", source: "exif" },
      { ...gpsTime("2024:06:01", [2, 1, 0])!, kind: "gps", source: "exif" },
    ],
    devices: [], serials: [], software: [], people: [], locations: [], traces: [], revisions: [], signatures: [],
  };
  expect(summarize([file(1, "a.jpg", ev)]).warnings).toEqual([]);
  ev.times[1] = { ...gpsTime("2024:06:01", [2, 40, 0])!, kind: "gps", source: "exif" };
  expect(summarize([file(1, "a.jpg", ev)]).warnings.map((w) => w.code)).toEqual(["gps-time-mismatch"]);
});

test("副檔名的其他寫法", () => {
  expect(extensionMatches("IMG_1.JPG", "jpeg")).toBe(true);
  expect(extensionMatches("scan.tif", "tiff")).toBe(true);
  expect(extensionMatches("report.pdf.exe", "pdf")).toBe(false);
  expect(extensionMatches("no-extension", "pdf")).toBe(true);
});

test("PDF：文件資訊、XMP 的編輯紀錄、舊版本與簽章之後的修改", async () => {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 200]);
  doc.setAuthor("Reporter A");
  doc.setProducer("Scanner Pro");
  doc.setCreationDate(new Date("2024-06-01T02:00:00Z"));
  const ctx = doc.context;
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/" xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" xmp:CreatorTool="Writer 7">
<xmpMM:History><rdf:Seq><rdf:li stEvt:action="saved" stEvt:when="2024-06-02T09:00:00+08:00" stEvt:softwareAgent="Adobe Acrobat"/></rdf:Seq></xmpMM:History>
</rdf:Description></rdf:RDF></x:xmpmeta>`;
  doc.catalog.set(PDFName.of("Metadata"), ctx.register(ctx.stream(xmp, { Type: "Metadata", Subtype: "XML" })));
  // 簽章只涵蓋第一版
  const first = await doc.save({ useObjectStreams: false });
  const sig = ctx.register(
    ctx.obj({ Type: "Sig", Name: PDFString.of("Signer B"), M: PDFString.of("D:20240603100000+08'00'"), ByteRange: [0, 10, 20, first.length - 20], Contents: PDFHexString.of("00") }),
  );
  doc.catalog.set(PDFName.of("Sig"), sig);
  // 第二版接在第一版後面，模擬增量更新
  const second = await doc.save({ useObjectStreams: false });
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first);
  bytes.set(second, first.length);

  const ev = await examine(bytes, "pdf");
  expect(ev.people).toContainEqual({ role: "author", value: "Reporter A" });
  expect(ev.software).toEqual(expect.arrayContaining(["Scanner Pro", "Writer 7", "Adobe Acrobat"]));
  expect(ev.times).toContainEqual(expect.objectContaining({ kind: "created", source: "pdf", text: "2024-06-01 02:00:00", offset: "+00:00" }));
  expect(ev.times).toContainEqual(expect.objectContaining({ kind: "history", note: "saved · Adobe Acrobat" }));
  expect(ev.revisions).toEqual([first.length]);
  expect(ev.signatures).toEqual([expect.objectContaining({ name: "Signer B", coversWhole: false })]);
  const codes = summarize([{ index: 1, name: "a.pdf", format: "pdf", size: bytes.length, evidence: ev }]).warnings.map((w) => w.code);
  expect(codes).toEqual(["signed-then-modified", "pdf-revisions"]);
});

test("Word 與 LibreOffice：作者、最後修改者、建立、修改與列印時間、修訂次數", async () => {
  const core = `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
<dc:creator>Writer A</dc:creator><cp:lastModifiedBy>Editor B</cp:lastModifiedBy><cp:revision>7</cp:revision>
<dcterms:created>2024-06-01T02:00:00Z</dcterms:created><dcterms:modified>2024-06-03T02:00:00Z</dcterms:modified><cp:lastPrinted>2024-06-02T02:00:00Z</cp:lastPrinted></cp:coreProperties>`;
  const app = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion><TotalTime>95</TotalTime><Company>Org C</Company></Properties>`;
  const docx = await writeZip([
    { name: "[Content_Types].xml", data: enc.encode("<Types/>"), compress: true },
    { name: "docProps/core.xml", data: enc.encode(core), compress: true },
    { name: "docProps/app.xml", data: enc.encode(app), compress: true },
  ]);
  const ev = await examine(docx, "docx");
  expect(ev.people).toEqual([
    { role: "author", value: "Writer A" },
    { role: "last-modified-by", value: "Editor B" },
    { role: "company", value: "Org C" },
  ]);
  expect(ev.times.map((t) => t.kind)).toEqual(["created", "printed", "modified"]);
  expect(ev.traces).toEqual(expect.arrayContaining([{ code: "office-revision", count: 7 }, { code: "office-editing-time", count: 95 }]));
  expect(ev.software).toEqual(["Microsoft Office Word 16.0000"]);

  const meta = `<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta>
<meta:initial-creator>Writer A</meta:initial-creator><dc:creator>Editor B</dc:creator><meta:creation-date>2024-06-01T10:00:00</meta:creation-date>
<dc:date>2024-06-01T09:00:00</dc:date><meta:editing-cycles>3</meta:editing-cycles><meta:editing-duration>PT1H5M</meta:editing-duration><meta:generator>LibreOffice/24.2</meta:generator></office:meta></office:document-meta>`;
  const odt = await writeZip([
    { name: "mimetype", data: enc.encode("application/vnd.oasis.opendocument.text"), compress: false },
    { name: "meta.xml", data: enc.encode(meta), compress: true },
  ]);
  const odf = await examine(odt, "odt");
  expect(odf.traces).toEqual(expect.arrayContaining([{ code: "office-revision", count: 3 }, { code: "office-editing-time", count: 65 }]));
  // 修改（9 點）早於建立（10 點），兩者都沒有時區
  expect(summarize([{ index: 1, name: "a.odt", format: "odt", size: 1, evidence: odf }]).warnings.map((w) => w.code)).toEqual(["modified-before-created"]);
});

test("影片與其他格式：沿用清除中繼資料的檢查結果，MP4 的時間當成 UTC", async () => {
  const ev = await examine(new Uint8Array(16), "mp4", [
    { code: "datetime", value: "2024-06-01 02:00:00" },
    { code: "location", value: "25.03300, 121.56540" },
    { code: "device", value: "Phone 15" },
  ]);
  expect(ev.times).toEqual([expect.objectContaining({ kind: "recorded", text: "2024-06-01 02:00:00", offset: "+00:00" })]);
  expect(ev.locations).toEqual([{ lat: 25.033, lon: 121.5654 }]);
  expect(ev.devices).toEqual(["Phone 15"]);
});

test("SHA-256 分段計算的結果跟一次算的相同", async () => {
  expect(await sha256Blob(new Blob([enc.encode("abc")]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const big = new Uint8Array(9 * 1024 * 1024 + 5).fill(7);
  const progress: number[] = [];
  const split = await sha256Blob(new Blob([big]), (p) => progress.push(p));
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const { bytesToHex } = await import("@noble/hashes/utils.js");
  expect(split).toBe(bytesToHex(sha256(big)));
  expect(progress.at(-1)).toBe(1);
});

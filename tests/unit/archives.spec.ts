import { expect, test } from "@playwright/test";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { ToolError } from "../../src/core/tool.ts";
import { entryData, readZip } from "../../src/core/zip.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import {
  ARCHIVE_SECRETS,
  EPUB_BODY,
  HTML_SOURCE,
  NOTE,
  TORRENT_INFO,
  gzipWithName,
  syntheticEpub,
  syntheticTar,
  syntheticTorrent,
  syntheticZip,
} from "../helpers/archives.ts";

const enc = new TextEncoder();
const has = (data: Uint8Array, part: Uint8Array | string) => Buffer.from(data).includes(typeof part === "string" ? Buffer.from(part) : Buffer.from(part));

// 壓縮檔裡的內容要解開才看得到
async function contents(data: Uint8Array, format: Format): Promise<Uint8Array> {
  if (format === "zip" || format === "epub") {
    const parts: Uint8Array[] = [];
    for (const entry of readZip(data).entries) parts.push(await entryData(data, entry));
    return new Uint8Array(Buffer.concat(parts));
  }
  if (format === "gz") {
    const out = await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return new Uint8Array(out);
  }
  return data;
}

const leaks = (data: Uint8Array) => ARCHIVE_SECRETS.filter((s) => has(data, s));

const cases: { name: string; file: () => Uint8Array | Promise<Uint8Array>; format: Format; expect: string[]; keep: (Uint8Array | string)[] }[] = [
  { name: "ZIP", file: syntheticZip, format: "zip", expect: ["comment", "datetime", "device", "location", "other", "system-files"], keep: [NOTE] },
  { name: "TAR", file: syntheticTar, format: "tar", expect: ["datetime", "device", "location", "other", "owner", "system-files"], keep: [NOTE] },
  { name: "TAR.GZ", file: async () => gzipWithName(syntheticTar()), format: "gz", expect: ["datetime", "location", "owner", "text"], keep: [NOTE] },
  { name: "EPUB", file: () => syntheticEpub(), format: "epub", expect: ["datetime", "device", "location", "other", "owner"], keep: [EPUB_BODY, "VISIBLE-TITLE"] },
  { name: "種子檔", file: syntheticTorrent, format: "torrent", expect: ["comment", "datetime", "owner", "software"], keep: [TORRENT_INFO] },
  { name: "HTML", file: () => enc.encode(HTML_SOURCE), format: "html", expect: ["comment", "owner", "path", "software"], keep: [EPUB_BODY, "KEEP-IN-SCRIPT", 'name="viewport"', 'charset="utf-8"'] },
];

for (const c of cases) {
  test(`${c.name}：讀得到資訊，清除後沒有秘密字串，內容還在`, async () => {
    const input = await c.file();
    expect(sniff(input)).toBe(c.format);
    const before = (await stripMetadata.inspect(input, c.format)).map((f) => f.code);
    for (const code of c.expect) expect(before, code).toContain(code);

    const { data, report } = await stripMetadata.run(input, c.format);
    expect(sniff(data)).toBe(c.format);
    expect(report.removed.length).toBeGreaterThan(0);
    const inside = await contents(data, c.format);
    expect(leaks(data)).toEqual([]);
    expect(leaks(inside)).toEqual([]);
    for (const part of c.keep) expect(has(inside, part), String(part)).toBe(true);
    expect(await stripMetadata.inspect(data, c.format)).toEqual([]);
  });
}

test("ZIP：時間統一、沒有附加欄位與註解，系統檔拿掉，資料夾還在", async () => {
  const { data } = await stripMetadata.run(syntheticZip(), "zip");
  const { entries, commentLength } = readZip(data);
  expect(entries.map((e) => e.name)).toEqual(["notes.txt", "photos/", "photos/photo.jpg"]);
  expect(entries.every((e) => e.extraLength === 0 && e.date === 0x21 && e.time === 0 && e.madeBy === 0)).toBe(true);
  expect(commentLength).toBe(0);
});

test("TAR：擁有者與時間清掉，權限保留，標頭的檢查碼正確", async () => {
  const { data } = await stripMetadata.run(syntheticTar(), "tar");
  for (let at = 0; at + 512 <= data.length; ) {
    const header = data.subarray(at, at + 512);
    if (header.every((x) => x === 0)) break;
    const sum = header.reduce((n, x, i) => n + (i >= 148 && i < 156 ? 0x20 : x), 0);
    expect(parseInt(Buffer.from(header.subarray(148, 154)).toString(), 8)).toBe(sum);
    expect(Buffer.from(header.subarray(100, 107)).toString()).toBe("0000644");
    expect(Buffer.from(header.subarray(136, 147)).toString()).toBe("00000000000");
    const size = parseInt(Buffer.from(header.subarray(124, 135)).toString(), 8);
    at += 512 + Math.ceil(size / 512) * 512;
  }
});

test("gzip：標頭沒有檔名與時間", async () => {
  const { data } = await stripMetadata.run(await gzipWithName(syntheticTar()), "gz");
  expect(data[3]! & 0x1e).toBe(0);
  expect([...data.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
});

test("種子檔：info 一個位元組都不變，種子的識別碼相同", async () => {
  const { data } = await stripMetadata.run(syntheticTorrent(), "torrent");
  expect(Buffer.from(data).toString("latin1")).toBe(`d8:announce28:udp://tracker.example.org:804:info${Buffer.from(TORRENT_INFO).toString("latin1")}e`);
});

test("EPUB：mimetype 仍在第一個，識別碼換成新的", async () => {
  const { data } = await stripMetadata.run(await syntheticEpub(), "epub");
  const { entries } = readZip(data);
  expect(entries[0]).toMatchObject({ name: "mimetype", method: 0 });
  const opf = new TextDecoder().decode(await entryData(data, entries.find((e) => e.name === "OEBPS/content.opf")!));
  expect(opf).toMatch(/<dc:identifier id="id">urn:uuid:[0-9a-f-]{36}<\/dc:identifier>/);
  expect(opf).not.toContain("00000000-0000-4000-8000-000000000000");
  expect(opf).toContain('<meta name="cover" content="cover"/>');
  expect(opf).toContain("<dc:language>zh-TW</dc:language>");
});

test("有 DRM 的 EPUB 不處理", async () => {
  await expect(stripMetadata.run(await syntheticEpub({ drm: true }), "epub")).rejects.toThrow(ToolError);
});

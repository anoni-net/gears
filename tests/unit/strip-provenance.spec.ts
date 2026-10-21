import { expect, test } from "@playwright/test";
import { concat } from "../../src/core/bytes.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { hasC2pa } from "../../src/tools/verify/provenance.ts";
import {
  C2PA_SECRET,
  C2PA_UUID,
  GIF_IMAGE,
  buildTiff,
  bytes,
  c2paJumbf,
  chunk,
  contains,
  exifSegment,
  heifBox,
  insertIntoJpeg,
  insertIntoPng,
  segment,
  syntheticHeif,
  syntheticJpeg,
  syntheticPng,
  syntheticWebp,
} from "../helpers/fixtures.ts";
import { syntheticMp4 } from "../helpers/media.ts";

// 清除中繼資料把 C2PA 內容憑證與 GB 45438 的標識列成單獨的一項，讀者看得到拿掉的是什麼。
// 服務提供者編碼是編出來的，不對應任何真實的個人
const PERSON = `0022${"19900001111"}${"0".repeat(7)}00000`;
const AIGC = { Label: "1", ContentProducer: PERSON, ProduceID: "pid-strip-1" };

const codes = (items: { code: string }[]) => items.map((i) => i.code);
const app11 = () => segment(0xeb, concat([bytes("JP"), new Uint8Array([0, 1, 0, 0, 0, 1]), c2paJumbf()]));

test("JPEG：APP11 的內容憑證與 XMP、EXIF 裡的 GB 45438 標識", async () => {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:TC260="http://www.tc260.org.cn/ns/AIGC/1.0/" TC260:AIGC="${JSON.stringify(AIGC).replaceAll('"', "&quot;")}"/></rdf:RDF></x:xmpmeta>`;
  const input = insertIntoJpeg(syntheticJpeg(), app11(), segment(0xe1, bytes(`http://ns.adobe.com/xap/1.0/\0${xmp}`)));
  const findings = await stripMetadata.inspect(input, "jpeg");
  expect(codes(findings)).toContain("c2pa");
  expect(findings.find((f) => f.code === "aigc")?.value).toBe(PERSON);

  const { data, report } = await stripMetadata.run(input, "jpeg");
  expect(codes(report.removed)).toContain("c2pa");
  expect(contains(data, C2PA_SECRET)).toBe(false);
  expect(contains(data, "19900001111")).toBe(false);

  const comment = buildTiff({ ifd0: [{ tag: 0x010f, type: 2, value: "TestMaker" }], exif: [{ tag: 0x9286, type: 7, value: concat([bytes("ASCII\0\0\0"), bytes(JSON.stringify({ AIGC }))]) }] });
  const exif = concat([new Uint8Array([0xff, 0xd8]), exifSegment(comment), segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])), new Uint8Array([0x12, 0xff, 0xd9])]);
  expect((await stripMetadata.inspect(exif, "jpeg")).find((f) => f.code === "aigc")?.value).toBe(PERSON);
});

test("PNG：caBX 與關鍵字為 AIGC 的 tEXt", async () => {
  const input = insertIntoPng(syntheticPng(), chunk("caBX", c2paJumbf()), chunk("tEXt", bytes(`AIGC\0${JSON.stringify({ AIGC })}`)));
  const findings = await stripMetadata.inspect(input, "png");
  expect(codes(findings)).toContain("c2pa");
  expect(findings.find((f) => f.code === "aigc")?.value).toBe(PERSON);
  const { data, report } = await stripMetadata.run(input, "png");
  expect(codes(report.removed)).toEqual(expect.arrayContaining(["c2pa", "aigc"]));
  expect(contains(data, C2PA_SECRET)).toBe(false);
  expect(contains(data, "19900001111")).toBe(false);
});

test("WebP、GIF、JPEG XL 與 TIFF 的內容憑證", async () => {
  const webp = syntheticWebp();
  const chunkHead = concat([bytes("C2PA"), new Uint8Array(4)]);
  const jumbf = c2paJumbf();
  new DataView(chunkHead.buffer).setUint32(4, jumbf.length, true);
  const withC2pa = concat([webp, chunkHead, jumbf, new Uint8Array(jumbf.length % 2)]);
  new DataView(withC2pa.buffer).setUint32(4, withC2pa.length - 8, true);
  expect(codes(await stripMetadata.inspect(withC2pa, "webp"))).toContain("c2pa");
  const webpOut = await stripMetadata.run(withC2pa, "webp");
  expect(codes(webpOut.report.removed)).toContain("c2pa");
  expect(contains(webpOut.data, C2PA_SECRET)).toBe(false);

  const blocks = (data: Uint8Array) => concat([new Uint8Array([data.length]), data, new Uint8Array([0])]);
  const gif = concat([
    bytes("GIF89a"),
    new Uint8Array([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255]),
    new Uint8Array([0x21, 0xff, 11]),
    bytes("C2PA_GIF"),
    new Uint8Array([1, 0, 0]),
    blocks(bytes(C2PA_SECRET)),
    GIF_IMAGE,
    new Uint8Array([0x3b]),
  ]);
  expect(codes(await stripMetadata.inspect(gif, "gif"))).toContain("c2pa");
  const gifOut = await stripMetadata.run(gif, "gif");
  expect(codes(gifOut.report.removed)).toContain("c2pa");
  expect(contains(gifOut.data, C2PA_SECRET)).toBe(false);

  const jxl = concat([heifBox("JXL ", new Uint8Array([0x0d, 0x0a, 0x87, 0x0a])), heifBox("ftyp", bytes("jxl "), new Uint8Array(4), bytes("jxl ")), heifBox("jxlc", bytes("FAKE")), c2paJumbf()]);
  expect(codes(await stripMetadata.inspect(jxl, "jxl"))).toContain("c2pa");
  expect(codes((await stripMetadata.run(jxl, "jxl")).report.removed)).toEqual(["c2pa"]);

  const tiff = buildTiff({ ifd0: [{ tag: 256, type: 3, value: [1] }, { tag: 0xcd41, type: 7, value: c2paJumbf() }] });
  expect(codes(await stripMetadata.inspect(tiff, "tiff"))).toContain("c2pa");
});

test("HEIF：最上層的內容憑證原本會留在檔案裡，改成同樣長度的 free box", async () => {
  const input = concat([syntheticHeif(), heifBox("uuid", C2PA_UUID, new Uint8Array(4), c2paJumbf())]);
  expect(hasC2pa(input, "heic")).toBe(true);
  expect(codes(await stripMetadata.inspect(input, "heic"))).toContain("c2pa");

  const { data, report } = await stripMetadata.run(input, "heic");
  expect(codes(report.removed)).toContain("c2pa");
  expect(data.length).toBe(input.length);
  expect(contains(data, C2PA_SECRET)).toBe(false);
  expect(hasC2pa(data, "heic")).toBe(false);
  expect(await stripMetadata.inspect(data, "heic")).toEqual([]);
});

test("MP4：內容憑證的 uuid 在報告裡分開列", async () => {
  const input = concat([syntheticMp4(), heifBox("uuid", C2PA_UUID, new Uint8Array(4), c2paJumbf())]);
  expect(codes(await stripMetadata.inspect(input, "mp4"))).toContain("c2pa");
  const { data, report } = await stripMetadata.run(input, "mp4");
  expect(codes(report.removed)).toContain("c2pa");
  expect(contains(data, C2PA_SECRET)).toBe(false);
});

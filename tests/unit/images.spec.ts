import { expect, test } from "@playwright/test";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { ToolError } from "../../src/core/tool.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import {
  GIF_IMAGE,
  JXL_CODESTREAM,
  PNM_PIXELS,
  SECRETS,
  SVG_SOURCE,
  TIFF_PIXELS,
  WEBP_IMAGE,
  bytes,
  contains,
  syntheticBmp,
  syntheticGif,
  syntheticHeif,
  syntheticJxl,
  syntheticPpm,
  syntheticTiff,
  syntheticWebp,
} from "../helpers/fixtures.ts";

const codes = (findings: { code: string }[]) => findings.map((f) => f.code).sort();
const has = (data: Uint8Array, part: Uint8Array) => Buffer.from(data).includes(Buffer.from(part));

// 每種格式：認得格式、讀得到資訊、清除後沒有任何秘密字串、檢查不到資訊、影像資料還在
const cases: { name: string; file: () => Uint8Array; format: Format; expect: string[]; image?: Uint8Array }[] = [
  { name: "GIF", file: syntheticGif, format: "gif", expect: ["comment", "trailer", "xmp"], image: GIF_IMAGE },
  { name: "WebP", file: syntheticWebp, format: "webp", expect: ["datetime", "device", "location", "other", "owner", "serial", "software", "thumbnail", "xmp"], image: WEBP_IMAGE },
  { name: "TIFF", file: syntheticTiff, format: "tiff", expect: ["comment", "datetime", "device", "location", "owner", "serial", "software", "xmp"], image: TIFF_PIXELS },
  { name: "AVIF", file: () => syntheticHeif(1, "avif"), format: "avif", expect: ["datetime", "device", "location", "owner", "serial", "software", "thumbnail", "xmp"] },
  { name: "BMP", file: syntheticBmp, format: "bmp", expect: ["trailer"] },
  { name: "PPM", file: syntheticPpm, format: "pnm", expect: ["comment"], image: PNM_PIXELS },
  { name: "SVG", file: () => bytes(SVG_SOURCE), format: "svg", expect: ["comment", "owner", "software", "text", "xmp"] },
  { name: "JPEG XL", file: syntheticJxl, format: "jxl", expect: ["datetime", "device", "location", "other", "owner", "serial", "software", "thumbnail", "xmp"], image: JXL_CODESTREAM },
];

for (const c of cases) {
  test(`${c.name}：讀得到資訊，清除之後沒有殘留，影像資料還在`, async () => {
    const input = c.file();
    expect(sniff(input)).toBe(c.format);
    expect(codes((await stripMetadata.inspect(input, c.format)))).toEqual([...c.expect].sort());
    const { data } = (await stripMetadata.run(input, c.format));
    expect(sniff(data)).toBe(c.format);
    for (const secret of SECRETS) expect(contains(data, secret), `${c.name} ${secret}`).toBe(false);
    expect((await stripMetadata.inspect(data, c.format))).toEqual([]);
    if (c.image) expect(has(data, c.image)).toBe(true);
  });
}

test("TIFF：原地改寫，長度不變，影像資料的位置也不變", async () => {
  const input = syntheticTiff();
  const { data } = (await stripMetadata.run(input, "tiff"));
  expect(data.length).toBe(input.length);
  expect(Buffer.from(data.subarray(-TIFF_PIXELS.length))).toEqual(Buffer.from(TIFF_PIXELS));
});

test("WebP：VP8X 的 EXIF 與 XMP 旗標清掉，RIFF 長度重算", async () => {
  const { data } = (await stripMetadata.run(syntheticWebp(), "webp"));
  const view = new DataView(data.buffer, data.byteOffset);
  expect(view.getUint32(4, true)).toBe(data.length - 8);
  expect(data[20]! & 0x0c).toBe(0);
});

test("SVG：拿掉 metadata、註解與編輯器的屬性，樣式、文字與屬性值裡的 > 原樣保留", async () => {
  const out = new TextDecoder().decode((await stripMetadata.run(bytes(SVG_SOURCE), "svg")).data);
  expect(out).toContain("/* keep > this */");
  expect(out).toContain('data-note="a > b"');
  expect(out).toContain("台灣 &amp; anoni");
  expect(out).not.toMatch(/inkscape|sodipodi|metadata|<!--/);
  expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test("JPEG XL：Exif box 沒有位移前綴也讀得到", async () => {
  expect(codes((await stripMetadata.inspect(syntheticJxl(false), "jxl")))).toContain("location");
});

test("BMP 沒有附加資料時原樣交回", async () => {
  const input = syntheticBmp(false);
  expect((await stripMetadata.inspect(input, "bmp"))).toEqual([]);
  expect(Buffer.from((await stripMetadata.run(input, "bmp")).data)).toEqual(Buffer.from(input));
});

test("文字格式的 PPM：資料中間的註解也拿掉", async () => {
  const input = bytes("P3\n# SECRET-COMMENT\n2 1\n255\n200 30 30 # Jane Doe\n30 160 60\n");
  const out = new TextDecoder().decode((await stripMetadata.run(input, "pnm")).data);
  expect(out).not.toContain("#");
  expect(out).toContain("200 30 30");
});

test("結構損壞的 GIF、WebP、TIFF 停下來", async () => {
  await expect(stripMetadata.run(syntheticGif().subarray(0, 40), "gif")).rejects.toThrow(ToolError);
  await expect(stripMetadata.run(syntheticWebp().subarray(0, 30), "webp")).rejects.toThrow(ToolError);
  await expect(stripMetadata.run(syntheticTiff().subarray(0, 12), "tiff")).rejects.toThrow(ToolError);
});

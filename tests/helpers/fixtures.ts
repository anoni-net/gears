// 測試用的檔案在測試裡現場產生，不把照片放進 repo。
//
// 這裡的產生器只在 Node 裡執行：e2e 測試先在瀏覽器用 canvas 產生一張真的可以
// 解碼的 JPEG 或 PNG，回到 Node 用這裡的函式塞進中繼資料，再交給頁面。

import { concat } from "../../src/core/bytes.ts";
// TIFF 與 JPEG 區段的寫法跟範例的照片共用
import { buildTiff, exifSegment, insertIntoJpeg, segment, type TiffValue } from "../../src/tools/samples/exif.ts";

export { buildTiff, exifSegment, insertIntoJpeg, segment, type TiffValue };

const enc = new TextEncoder();
export const bytes = (text: string) => enc.encode(text);

// --- EXIF（TIFF，大端序） ---

// 台北 101 附近的座標，度分秒寫成有理數
export const LAT = [25, 1, 1, 1, 5880, 100]; // 25°1'58.80" ≈ 25.03300
export const LON = [121, 1, 33, 1, 5544, 100]; // 121°33'55.44" ≈ 121.56540

export function sampleTiff(orientation = 6): Uint8Array {
  return buildTiff({
    ifd0: [
      { tag: 0x010f, type: 2, value: "TestMaker" },
      { tag: 0x0110, type: 2, value: "SECRET-MODEL" },
      { tag: 0x0112, type: 3, value: [orientation] },
      { tag: 0x0131, type: 2, value: "PhotoApp 1.0" },
      { tag: 0x013b, type: 2, value: "Jane Doe" },
    ],
    exif: [
      { tag: 0x9003, type: 2, value: "2026:10:14 09:30:00" },
      { tag: 0xa431, type: 2, value: "SN-123456" },
    ],
    gps: [
      { tag: 0x0001, type: 2, value: "N" },
      { tag: 0x0002, type: 5, value: LAT },
      { tag: 0x0003, type: 2, value: "E" },
      { tag: 0x0004, type: 5, value: LON },
    ],
    thumbnail: true,
  });
}

// --- JPEG ---

// JFIF 區段，可以帶一張 1×1 的縮圖
export function jfifSegment(thumbnail: boolean): Uint8Array {
  const body = [...bytes("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, thumbnail ? 1 : 0, thumbnail ? 1 : 0];
  if (thumbnail) body.push(0xaa, 0xbb, 0xcc);
  return segment(0xe0, new Uint8Array(body));
}

// 不能解碼、但結構完整的 JPEG，給單元測試檢查每一段的去留。
// 掃描資料裡放了跳脫的 0xFF00 與 RST，兩段 SOS 模擬漸進式 JPEG。
export const SCAN1 = new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
export const SCAN2 = new Uint8Array([0x78, 0x9a, 0xff, 0x00, 0xbc]);

export function syntheticJpeg(opts: { orientation?: number; trailer?: boolean } = {}): Uint8Array {
  const sos = segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0]));
  return concat([
    new Uint8Array([0xff, 0xd8]),
    jfifSegment(true),
    exifSegment(sampleTiff(opts.orientation ?? 6)),
    segment(0xe1, bytes("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude=\"25,1.98N\"/>")),
    segment(0xe2, concat([bytes("ICC_PROFILE\0"), new Uint8Array([1, 1, 9, 9, 9])])),
    segment(0xe2, bytes("MPF\0SECRET-MPF")),
    segment(0xed, bytes("Photoshop 3.0\0SECRET-IPTC")),
    segment(0xee, bytes("Adobe\0d\0\0\0\0\x01")),
    segment(0xe5, bytes("VENDOR-SECRET")),
    segment(0xfe, bytes("SECRET-COMMENT")),
    segment(0xdb, new Uint8Array(65)),
    segment(0xc2, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    segment(0xc4, new Uint8Array(20)),
    sos,
    SCAN1,
    segment(0xc4, new Uint8Array(20)),
    sos,
    SCAN2,
    new Uint8Array([0xff, 0xd9]),
    ...(opts.trailer === false ? [] : [bytes("MOTION-PHOTO-SECRET")]),
  ]);
}

// --- PNG ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(bytes(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function metadataChunks(): Uint8Array[] {
  return [
    chunk("tEXt", bytes("Author\0Jane Doe")),
    chunk("tEXt", bytes("Comment\0SECRET-PNG-COMMENT")),
    chunk("iTXt", bytes("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>")),
    chunk("tIME", new Uint8Array([0x07, 0xea, 10, 14, 9, 30, 0])),
    chunk("eXIf", sampleTiff(1)),
    chunk("prVt", bytes("PRIVATE-SECRET")),
  ];
}

// 把 chunk 插在 IHDR 之後
export function insertIntoPng(png: Uint8Array, ...chunks: Uint8Array[]): Uint8Array {
  const at = 8 + 12 + 13;
  return concat([png.subarray(0, at), ...chunks, png.subarray(at)]);
}

export function syntheticPng(): Uint8Array {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...metadataChunks(),
    chunk("IDAT", new Uint8Array([1, 2, 3])),
    chunk("IEND", new Uint8Array()),
    bytes("PNG-TRAILER-SECRET"),
  ]);
}

export function contains(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(needle);
}

// --- HEIC（HEIF） ---
//
// 結構完整、不能解碼的 HEIF：一個假的 hvc1 影像 item、一個 Exif item、一個 XMP item。
// Exif 放在 mdat（construction_method 0），XMP 放在 meta 裡的 idat（construction_method 1），
// 兩種存放方式都測到。真的 HEIC 在本機用 libheif 產生來驗證，不進 repo。

export function heifBox(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(payload);
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, 8 + body.length);
  head.set(bytes(type), 4);
  return concat([head, body]);
}

const fullBox = (type: string, version: number, ...payload: Uint8Array[]) =>
  heifBox(type, new Uint8Array([version, 0, 0, 0]), ...payload);

const u16 = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const u32 = (n: number) => new Uint8Array([n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

export const HEVC_DATA = bytes("FAKE-HEVC-IMAGE-DATA-0123456789");
export const XMP_DATA = bytes('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF exif:GPSLatitude="25,1.98N"/></x:xmpmeta>');

export function syntheticHeif(ilocVersion: 0 | 1 = 1, brand = "heic"): Uint8Array {
  const exifPayload = concat([u32(6), bytes("Exif\0\0"), sampleTiff()]);
  const ftyp = heifBox("ftyp", bytes(brand), u32(0), bytes(`mif1${brand}`));
  const infe = (id: number, type: string, extra: string) => fullBox("infe", 2, u16(id), u16(0), bytes(type), bytes(`\0${extra}`));
  const iinf = fullBox("iinf", 0, u16(3), infe(1, "hvc1", ""), infe(2, "Exif", ""), infe(3, "mime", "application/rdf+xml\0"));
  const idat = heifBox("idat", XMP_DATA);

  // iloc 先用佔位的位移組出來，算出 mdat 的位置之後再填
  const build = (mdatData: number, idatBase: number) => {
    const sizes = u16((4 << 12) | (4 << 8) | (0 << 4) | 0);
    const item = (id: number, method: number, offset: number, length: number) =>
      concat([
        u16(id),
        ...(ilocVersion >= 1 ? [u16(method)] : []),
        u16(0),
        u16(1),
        u32(offset),
        u32(length),
      ]);
    const items =
      ilocVersion >= 1
        ? [item(1, 0, mdatData, HEVC_DATA.length), item(2, 0, mdatData + HEVC_DATA.length, exifPayload.length), item(3, 1, idatBase, XMP_DATA.length)]
        : [item(1, 0, mdatData, HEVC_DATA.length), item(2, 0, mdatData + HEVC_DATA.length, exifPayload.length)];
    const iloc = fullBox("iloc", ilocVersion, sizes, u16(items.length), ...items);
    const meta = fullBox("meta", 0, fullBox("hdlr", 0, u32(0), bytes("pict"), new Uint8Array(13)), fullBox("pitm", 0, u16(1)), iinf, iloc, idat);
    return meta;
  };
  const metaLength = build(0, 0).length;
  const mdatData = ftyp.length + metaLength + 8;
  const meta = build(mdatData, 0);
  return concat([ftyp, meta, heifBox("mdat", HEVC_DATA, exifPayload)]);
}

// --- 其他圖片格式 ---

export const SECRETS = ["SECRET-MODEL", "Jane Doe", "SN-123456", "GPSLatitude", "SECRET-COMMENT", "SECRET-XMP", "SECRET-TRAILER", "janedoe"];

const subBlocks = (data: Uint8Array) => {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const part = data.subarray(i, i + 255);
    out.push(part.length, ...part);
  }
  out.push(0);
  return new Uint8Array(out);
};

export const GIF_IMAGE = new Uint8Array([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00]);

export function syntheticGif(): Uint8Array {
  return concat([
    bytes("GIF89a"),
    new Uint8Array([1, 0, 1, 0, 0x80, 0, 0]), // 1×1，2 色的全域調色盤
    new Uint8Array([0, 0, 0, 255, 255, 255]),
    new Uint8Array([0x21, 0xff, 11]), bytes("NETSCAPE2.0"), new Uint8Array([3, 1, 0, 0, 0]),
    new Uint8Array([0x21, 0xfe]), subBlocks(bytes("SECRET-COMMENT by Jane Doe")),
    new Uint8Array([0x21, 0xff, 11]), bytes("XMP DataXMP"), subBlocks(bytes("<x:xmpmeta>SECRET-XMP</x:xmpmeta>")),
    new Uint8Array([0x21, 0xf9, 4, 0, 10, 0, 0, 0]),
    GIF_IMAGE,
    new Uint8Array([0x3b]),
    bytes("SECRET-TRAILER"),
  ]);
}

const riffChunk = (type: string, data: Uint8Array) => {
  const head = new Uint8Array(8);
  head.set(bytes(type));
  new DataView(head.buffer).setUint32(4, data.length, true);
  return concat([head, data, data.length & 1 ? new Uint8Array(1) : new Uint8Array()]);
};

export const WEBP_IMAGE = bytes("FAKE-VP8L-DATA");

export function syntheticWebp(): Uint8Array {
  const body = concat([
    bytes("WEBP"),
    riffChunk("VP8X", new Uint8Array([0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
    riffChunk("VP8L", WEBP_IMAGE),
    riffChunk("EXIF", concat([bytes("Exif\0\0"), sampleTiff()])),
    riffChunk("XMP ", bytes("<x:xmpmeta exif:GPSLatitude='1'>SECRET-XMP</x:xmpmeta>")),
    riffChunk("SECR", bytes("SECRET-COMMENT!")),
  ]);
  const head = concat([bytes("RIFF"), new Uint8Array(4)]);
  new DataView(head.buffer).setUint32(4, body.length, true);
  return concat([head, body]);
}

// 2×1 的 RGB 影像，IFD0 同時有影像結構與描述用的標籤，另外有 EXIF 與 GPS 子 IFD
export const TIFF_PIXELS = new Uint8Array([200, 30, 30, 30, 160, 60]);

export function syntheticTiff(): Uint8Array {
  const build = (stripOffset: number) =>
    buildTiff({
      ifd0: [
        { tag: 256, type: 3, value: [2] },
        { tag: 257, type: 3, value: [1] },
        { tag: 258, type: 3, value: [8, 8, 8] },
        { tag: 259, type: 3, value: [1] },
        { tag: 262, type: 3, value: [2] },
        { tag: 270, type: 2, value: "SECRET-COMMENT description" },
        { tag: 271, type: 2, value: "TestMaker" },
        { tag: 272, type: 2, value: "SECRET-MODEL" },
        { tag: 273, type: 4, value: [stripOffset] },
        { tag: 277, type: 3, value: [3] },
        { tag: 278, type: 3, value: [1] },
        { tag: 279, type: 4, value: [TIFF_PIXELS.length] },
        { tag: 284, type: 3, value: [1] },
        { tag: 305, type: 2, value: "PhotoApp 1.0" },
        { tag: 315, type: 2, value: "Jane Doe" },
        { tag: 700, type: 2, value: "<x:xmpmeta>SECRET-XMP</x:xmpmeta>" },
      ],
      exif: [
        { tag: 0x9003, type: 2, value: "2026:10:14 09:30:00" },
        { tag: 0xa431, type: 2, value: "SN-123456" },
      ],
      gps: [
        { tag: 0x0001, type: 2, value: "N" },
        { tag: 0x0002, type: 5, value: LAT },
        { tag: 0x0003, type: 2, value: "E" },
        { tag: 0x0004, type: 5, value: LON },
      ],
    });
  const length = build(0).length;
  return concat([build(length), TIFF_PIXELS]);
}

export function syntheticBmp(trailer = true): Uint8Array {
  const pixels = new Uint8Array([30, 30, 200, 60, 160, 30, 0, 0]); // 2×1，BGR，每列補到 4 的倍數
  const head = new Uint8Array(54);
  const v = new DataView(head.buffer);
  head.set(bytes("BM"));
  v.setUint32(2, 54 + pixels.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, 2, true);
  v.setInt32(22, 1, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  return concat([head, pixels, trailer ? bytes("SECRET-TRAILER") : new Uint8Array()]);
}

export const PNM_PIXELS = new Uint8Array([200, 30, 30, 30, 160, 60]);

export function syntheticPpm(): Uint8Array {
  return concat([bytes("P6\n# Created by Jane Doe SECRET-COMMENT\n2 1\n# another\n255\n"), PNM_PIXELS]);
}

export const SVG_SOURCE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SECRET-COMMENT Created with Inkscape -->
<svg width="4" height="2" xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:dc="http://purl.org/dc/elements/1.1/"
  sodipodi:docname="secret.svg" inkscape:export-filename="/home/janedoe/Documents/plan.png">
  <sodipodi:namedview id="nv" inkscape:zoom="2"><inkscape:grid id="g"/></sodipodi:namedview>
  <metadata><dc:creator>Jane Doe</dc:creator></metadata>
  <style>/* keep > this */ .a { fill: red; }</style>
  <rect class="a" width="4" height="2" data-note="a > b" inkscape:label="layer"/>
  <text>台灣 &amp; anoni</text>
</svg>
`;

const jxlBox = (type: string, data: Uint8Array) => heifBox(type, data);

export const JXL_CODESTREAM = new Uint8Array([0xff, 0x0a, 0x01, 0x02, 0x03, 0x04]);

export function syntheticJxl(withOffset = true): Uint8Array {
  return concat([
    new Uint8Array([0, 0, 0, 0x0c]), bytes("JXL \r\n"), new Uint8Array([0x87, 0x0a]),
    jxlBox("ftyp", concat([bytes("jxl "), u32(0), bytes("jxl ")])),
    jxlBox("Exif", concat([withOffset ? u32(0) : new Uint8Array(), sampleTiff()])),
    jxlBox("xml ", bytes("<x:xmpmeta>SECRET-XMP</x:xmpmeta>")),
    jxlBox("brob", concat([bytes("jumb"), bytes("SECRET-COMMENT-compressed")])),
    jxlBox("jxlc", JXL_CODESTREAM),
  ]);
}

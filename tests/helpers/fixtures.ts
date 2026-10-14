// 測試用的檔案在測試裡現場產生，不把照片放進 repo。
//
// 這裡的產生器只在 Node 裡執行：e2e 測試先在瀏覽器用 canvas 產生一張真的可以
// 解碼的 JPEG 或 PNG，回到 Node 用這裡的函式塞進中繼資料，再交給頁面。

import { concat } from "../../src/core/bytes.ts";

const enc = new TextEncoder();
export const bytes = (text: string) => enc.encode(text);

// --- EXIF（TIFF，大端序） ---

export interface TiffValue {
  tag: number;
  type: 2 | 3 | 4 | 5; // ASCII、SHORT、LONG、RATIONAL
  value: string | number[]; // RATIONAL 寫成 [分子, 分母, 分子, 分母, …]
}

const SIZE = { 2: 1, 3: 2, 4: 4, 5: 8 } as const;

function valueBytes(v: TiffValue): { data: Uint8Array; count: number } {
  if (v.type === 2) {
    const data = bytes(`${v.value as string}\0`);
    return { data, count: data.length };
  }
  const numbers = v.value as number[];
  const count = v.type === 5 ? numbers.length / 2 : numbers.length;
  const data = new Uint8Array(count * SIZE[v.type]);
  const view = new DataView(data.buffer);
  numbers.forEach((n, i) => {
    if (v.type === 3) view.setUint16(i * 2, n);
    else view.setUint32(i * 4, n);
  });
  return { data, count };
}

function ifdSize(entries: TiffValue[]) {
  let size = 2 + entries.length * 12 + 4;
  for (const e of entries) {
    const { data } = valueBytes(e);
    if (data.length > 4) size += data.length + (data.length % 2);
  }
  return size;
}

export function buildTiff(opts: { ifd0: TiffValue[]; exif?: TiffValue[]; gps?: TiffValue[]; thumbnail?: boolean }): Uint8Array {
  const ifd0 = [...opts.ifd0];
  // 指向 Exif IFD 與 GPS IFD 的項目先放佔位值，排好位置再填
  if (opts.exif) ifd0.push({ tag: 0x8769, type: 4, value: [0] });
  if (opts.gps) ifd0.push({ tag: 0x8825, type: 4, value: [0] });
  const ifd1: TiffValue[] | undefined = opts.thumbnail
    ? [
        { tag: 0x0201, type: 4, value: [0] },
        { tag: 0x0202, type: 4, value: [0] },
      ]
    : undefined;

  const list = [ifd0, opts.exif, opts.gps, ifd1].filter(Boolean) as TiffValue[][];
  const offsets: number[] = [];
  let at = 8;
  for (const entries of list) {
    offsets.push(at);
    at += ifdSize(entries);
  }
  const exifOffset = opts.exif ? offsets[1]! : 0;
  const gpsOffset = opts.gps ? offsets[opts.exif ? 2 : 1]! : 0;
  for (const e of ifd0) {
    if (e.tag === 0x8769) e.value = [exifOffset];
    if (e.tag === 0x8825) e.value = [gpsOffset];
  }

  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x4d], 0);
  view.setUint16(2, 42);
  view.setUint32(4, 8);
  list.forEach((entries, index) => {
    const offset = offsets[index]!;
    const sorted = [...entries].sort((a, b) => a.tag - b.tag);
    view.setUint16(offset, sorted.length);
    let data = offset + 2 + sorted.length * 12 + 4;
    sorted.forEach((e, i) => {
      const base = offset + 2 + i * 12;
      const { data: value, count } = valueBytes(e);
      view.setUint16(base, e.tag);
      view.setUint16(base + 2, e.type);
      view.setUint32(base + 4, count);
      if (value.length <= 4) {
        out.set(value, base + 8);
      } else {
        view.setUint32(base + 8, data);
        out.set(value, data);
        data += value.length + (value.length % 2);
      }
    });
    // IFD0 的下一個是 IFD1（縮圖）
    const next = index === 0 && ifd1 ? offsets[list.length - 1]! : 0;
    view.setUint32(offset + 2 + sorted.length * 12, next);
  });
  return out;
}

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

export function segment(marker: number, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  head[0] = 0xff;
  head[1] = marker;
  head[2] = (body.length + 2) >> 8;
  head[3] = (body.length + 2) & 0xff;
  return concat([head, body]);
}

export const exifSegment = (tiff: Uint8Array) => segment(0xe1, concat([bytes("Exif\0\0"), tiff]));

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

// 把區段插在 JPEG 的 SOI 與第一個 APP0 之後
export function insertIntoJpeg(jpeg: Uint8Array, ...segments: Uint8Array[]): Uint8Array {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4]! << 8) | jpeg[5]!);
  return concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)]);
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

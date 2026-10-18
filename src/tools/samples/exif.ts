// 寫 EXIF（TIFF，大端序）並插進 JPEG。範例的照片（src/ui/samples.ts）與測試
// （tests/helpers/fixtures.ts）共用。

import { concat } from "../../core/bytes.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

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

export function segment(marker: number, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(4);
  head[0] = 0xff;
  head[1] = marker;
  head[2] = (body.length + 2) >> 8;
  head[3] = (body.length + 2) & 0xff;
  return concat([head, body]);
}

export const exifSegment = (tiff: Uint8Array) => segment(0xe1, concat([bytes("Exif\0\0"), tiff]));

// 把區段插在 JPEG 的 SOI 與第一個 APP0 之後
export function insertIntoJpeg(jpeg: Uint8Array, ...segments: Uint8Array[]): Uint8Array {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4]! << 8) | jpeg[5]!);
  return concat([jpeg.subarray(0, at), ...segments, jpeg.subarray(at)]);
}

import { concat, type Format } from "../../core/bytes.ts";
import { crc32 } from "../../core/png-encode.ts";
import { exifOfHeif } from "../strip-metadata/heif.ts";
import { exifOfJpeg } from "../strip-metadata/jpeg.ts";
import { exifOfPng } from "../strip-metadata/png.ts";
import { exifOfWebp } from "../strip-metadata/webp.ts";

// 遮蔽時保留拍攝資訊：照片要當成證據時，拍攝的時間、地點與相機型號有用。遮蔽會重新
// 編碼整張圖，原檔的 EXIF 不會帶過去，讀者勾選時才把它重新組一份寫回輸出的檔案。
//
// 重組時一定要拿掉三樣東西：
// - IFD1 的縮圖：那是遮蔽之前的原圖，留著等於沒遮
// - MakerNote：相機廠商的私有區段，有些機型在裡面放了預覽圖
// - IPTC、XMP 與 Interoperability：XMP 也可以放縮圖
// 旋轉方向改成 1（正向），瀏覽器解碼時已經把圖轉正了。

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const EXIF_IFD = 0x8769;
const GPS_IFD = 0x8825;
const ORIENTATION = 0x0112;
// IFD0 拿掉的：Interoperability、XMP、IPTC、Photoshop、縮圖的位置與長度
const DROP_IFD0 = new Set([0xa005, 0x02bc, 0x83bb, 0x8649, 0x0201, 0x0202]);
// Exif IFD 拿掉的：MakerNote、Interoperability
const DROP_EXIF = new Set([0x927c, 0xa005]);

interface Entry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array; // 原本的位元組順序
}

export function extractExif(bytes: Uint8Array, format: Format): Uint8Array | null {
  if (format === "jpeg") return exifOfJpeg(bytes);
  if (format === "png") return exifOfPng(bytes);
  if (format === "webp") return exifOfWebp(bytes);
  if (format === "heic" || format === "avif") return exifOfHeif(bytes);
  return null;
}

// 重組一份只有 IFD0、Exif IFD 與 GPS IFD 的 TIFF，位元組順序沿用原檔。結構不對時回傳 null
export function rebuildExif(tiff: Uint8Array): Uint8Array | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, little) !== 42) return null;

  const read = (offset: number, drop: Set<number>): Entry[] | null => {
    if (offset < 8 || offset + 2 > tiff.length) return null;
    const count = view.getUint16(offset, little);
    if (offset + 2 + count * 12 > tiff.length) return null;
    const entries: Entry[] = [];
    for (let i = 0; i < count; i++) {
      const base = offset + 2 + i * 12;
      const tag = view.getUint16(base, little);
      const type = view.getUint16(base + 2, little);
      const n = view.getUint32(base + 4, little);
      const size = (TYPE_SIZE[type] ?? 0) * n;
      if (!size || drop.has(tag)) continue;
      const at = size <= 4 ? base + 8 : view.getUint32(base + 8, little);
      if (at + size > tiff.length) continue;
      entries.push({ tag, type, count: n, data: tiff.slice(at, at + size) });
    }
    return entries;
  };

  const ifd0 = read(view.getUint32(4, little), DROP_IFD0);
  if (!ifd0) return null;
  const pointer = (tag: number) => {
    const e = ifd0.find((x) => x.tag === tag);
    return e && e.data.length === 4 ? new DataView(e.data.buffer).getUint32(0, little) : undefined;
  };
  const exifAt = pointer(EXIF_IFD);
  const gpsAt = pointer(GPS_IFD);
  const exif = exifAt === undefined ? null : read(exifAt, DROP_EXIF);
  const gps = gpsAt === undefined ? null : read(gpsAt, new Set());

  const orientation = ifd0.find((e) => e.tag === ORIENTATION);
  if (orientation) {
    orientation.data = new Uint8Array(2);
    new DataView(orientation.data.buffer).setUint16(0, 1, little);
  }

  // 依序擺放：標頭、IFD0、IFD0 的長資料、Exif IFD、它的長資料、GPS IFD、它的長資料
  const ifds = [
    ifd0.filter((e) => e.tag !== EXIF_IFD && e.tag !== GPS_IFD),
    exif ?? [],
    gps ?? [],
  ];
  if (exif?.length) ifds[0]!.push({ tag: EXIF_IFD, type: 4, count: 1, data: new Uint8Array(4) });
  if (gps?.length) ifds[0]!.push({ tag: GPS_IFD, type: 4, count: 1, data: new Uint8Array(4) });
  for (const list of ifds) list.sort((a, b) => a.tag - b.tag);

  const sizeOf = (list: Entry[]) => 2 + list.length * 12 + 4 + list.reduce((n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length & 1) : 0), 0);
  const offsets: number[] = [];
  let total = 8;
  for (const [i, list] of ifds.entries()) {
    offsets.push(total);
    if (i === 0 || list.length) total += sizeOf(list);
  }
  const out = new Uint8Array(total);
  const w = new DataView(out.buffer);
  out.set(tiff.subarray(0, 4));
  w.setUint32(4, 8, little);
  const pointers: Record<number, number> = { [EXIF_IFD]: offsets[1]!, [GPS_IFD]: offsets[2]! };

  for (const [i, list] of ifds.entries()) {
    if (i > 0 && !list.length) continue;
    const start = offsets[i]!;
    let extra = start + 2 + list.length * 12 + 4;
    w.setUint16(start, list.length, little);
    list.forEach((e, k) => {
      const base = start + 2 + k * 12;
      w.setUint16(base, e.tag, little);
      w.setUint16(base + 2, e.type, little);
      w.setUint32(base + 4, e.count, little);
      if (i === 0 && e.tag in pointers) w.setUint32(base + 8, pointers[e.tag]!, little);
      else if (e.data.length <= 4) out.set(e.data, base + 8);
      else {
        w.setUint32(base + 8, extra, little);
        out.set(e.data, extra);
        extra += e.data.length + (e.data.length & 1);
      }
    });
    // 下一個 IFD 的位置寫 0：不留 IFD1（縮圖）
    w.setUint32(start + 2 + list.length * 12, 0, little);
  }
  return out;
}

// 寫回 JPEG：APP1 放在 SOI 之後，有 JFIF 的話放在 JFIF 之後
export function insertExifJpeg(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  const body = concat([new TextEncoder().encode("Exif\0\0"), tiff]);
  if (body.length + 2 > 0xffff) return jpeg;
  const segment = concat([new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4]! << 8) | jpeg[5]!);
  return concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}

// 寫回 PNG：eXIf chunk 放在 IHDR 之後
export function insertExifPng(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + tiff.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, tiff.length);
  chunk.set([0x65, 0x58, 0x49, 0x66], 4);
  chunk.set(tiff, 8);
  view.setUint32(8 + tiff.length, crc32(chunk.subarray(4, 8 + tiff.length)));
  const at = 8 + 12 + 13;
  return concat([png.subarray(0, at), chunk, png.subarray(at)]);
}

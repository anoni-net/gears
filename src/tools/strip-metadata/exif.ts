import type { Finding } from "../../core/tool.ts";

// 讀 EXIF（TIFF 結構）裡會透露身分或處境的欄位。只讀不寫，遇到格式錯誤就停在
// 讀得到的部分，不丟例外：清除照樣進行，畫面上少列幾項而已。
//
// 結構是 TIFF 標頭（位元組順序、42、第一個 IFD 的位置）接著一串 IFD。每個 IFD
// 是「項目數、每項 12 位元組、下一個 IFD 的位置」。IFD0 放相機資訊，另外指向
// Exif IFD（拍攝時間、鏡頭）與 GPS IFD（座標）。IFD0 之後的 IFD1 是縮圖。

export interface ExifInfo {
  orientation?: number;
  make?: string;
  model?: string;
  lens?: string;
  serial?: string;
  owner?: string;
  dateTime?: string;
  software?: string;
  gps: boolean;
  latitude?: number;
  longitude?: number;
  thumbnail: boolean;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

interface Entry {
  type: number;
  count: number;
  at: number; // 值所在的位置（相對於 TIFF 開頭）
}

export function parseExif(tiff: Uint8Array): ExifInfo {
  const info: ExifInfo = { gps: false, thumbnail: false };
  if (tiff.length < 8) return info;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return info;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) return info;

  const visited = new Set<number>();

  function readIfd(offset: number): { entries: Map<number, Entry>; next: number } | null {
    if (offset < 8 || offset + 2 > tiff.length || visited.has(offset)) return null;
    visited.add(offset);
    const count = u16(offset);
    if (offset + 2 + count * 12 + 4 > tiff.length) return null;
    const entries = new Map<number, Entry>();
    for (let i = 0; i < count; i++) {
      const base = offset + 2 + i * 12;
      const tag = u16(base);
      const type = u16(base + 2);
      const n = u32(base + 4);
      const size = (TYPE_SIZE[type] ?? 0) * n;
      if (!size) continue;
      const at = size <= 4 ? base + 8 : u32(base + 8);
      if (at + size > tiff.length) continue;
      entries.set(tag, { type, count: n, at });
    }
    return { entries, next: u32(offset + 2 + count * 12) };
  }

  const text = (e?: Entry) => {
    if (!e || e.type !== 2) return undefined;
    let s = "";
    for (let i = 0; i < e.count; i++) {
      const c = tiff[e.at + i]!;
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    s = s.trim();
    return s || undefined;
  };
  const short = (e?: Entry) => (e && e.type === 3 ? u16(e.at) : e && e.type === 4 ? u32(e.at) : undefined);
  const pointer = (e?: Entry) => (e && (e.type === 4 || e.type === 13) ? u32(e.at) : undefined);
  const rationals = (e?: Entry) => {
    if (!e || e.type !== 5) return undefined;
    const values: number[] = [];
    for (let i = 0; i < e.count; i++) {
      const num = u32(e.at + i * 8);
      const den = u32(e.at + i * 8 + 4);
      values.push(den ? num / den : 0);
    }
    return values;
  };

  const ifd0 = readIfd(u32(4));
  if (!ifd0) return info;
  const e0 = ifd0.entries;
  info.orientation = short(e0.get(0x0112));
  info.make = text(e0.get(0x010f));
  info.model = text(e0.get(0x0110));
  info.software = text(e0.get(0x0131));
  info.dateTime = text(e0.get(0x0132));
  info.owner = text(e0.get(0x013b)) ?? text(e0.get(0x8298));

  const exifIfd = readIfd(pointer(e0.get(0x8769)) ?? 0);
  if (exifIfd) {
    const ex = exifIfd.entries;
    info.dateTime = text(ex.get(0x9003)) ?? info.dateTime;
    info.owner = text(ex.get(0xa430)) ?? info.owner;
    info.serial = text(ex.get(0xa431));
    info.lens = text(ex.get(0xa434));
  }

  const gpsOffset = pointer(e0.get(0x8825));
  if (gpsOffset) {
    info.gps = true;
    const gpsIfd = readIfd(gpsOffset);
    if (gpsIfd) {
      const g = gpsIfd.entries;
      const lat = dms(rationals(g.get(2)));
      const lon = dms(rationals(g.get(4)));
      if (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0)) {
        info.latitude = text(g.get(1)) === "S" ? -lat : lat;
        info.longitude = text(g.get(3)) === "W" ? -lon : lon;
      }
    }
  }

  // IFD0 之後還有 IFD1 就是縮圖。縮圖常常是裁切之前的原圖。
  const ifd1 = readIfd(ifd0.next);
  if (ifd1 && (ifd1.entries.has(0x0201) || ifd1.entries.has(0x0111))) info.thumbnail = true;

  return info;
}

function dms(values?: number[]): number | undefined {
  if (!values || values.length < 3) return undefined;
  return values[0]! + values[1]! / 60 + values[2]! / 3600;
}

// HEIF 與 JPEG XL 的 Exif 區塊，規格上是 4 個位元組的位移再接 TIFF，但有些程式省略位移，
// 或在前面加上 Exif\0\0。依開頭判斷，找出 TIFF 開始的位置（相對於區塊開頭）
export function tiffStart(bytes: Uint8Array, at: number, end: number): number {
  const isTiff = (i: number) =>
    i + 4 <= end && ((bytes[i] === 0x4d && bytes[i + 1] === 0x4d && bytes[i + 3] === 0x2a) || (bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2a));
  if (isTiff(at)) return 0;
  const exifPrefix = (i: number) => i + 6 <= end && bytes[i] === 0x45 && bytes[i + 1] === 0x78 && bytes[i + 2] === 0x69 && bytes[i + 3] === 0x66;
  if (exifPrefix(at)) return 6;
  if (at + 4 > end) return end - at;
  const offset = ((bytes[at]! << 24) >>> 0) + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!);
  const start = 4 + offset;
  return at + start <= end ? start : end - at;
}

export function exifFindings(info: ExifInfo): Finding[] {
  const findings: Finding[] = [];
  if (info.gps) {
    findings.push({
      code: "location",
      value:
        info.latitude !== undefined && info.longitude !== undefined
          ? `${info.latitude.toFixed(5)}, ${info.longitude.toFixed(5)}`
          : undefined,
    });
  }
  const device = [info.make, info.model, info.lens].filter(Boolean).join(" ");
  if (device) findings.push({ code: "device", value: device });
  if (info.serial) findings.push({ code: "serial", value: info.serial });
  if (info.owner) findings.push({ code: "owner", value: info.owner });
  if (info.dateTime) findings.push({ code: "datetime", value: info.dateTime });
  if (info.software) findings.push({ code: "software", value: info.software });
  if (info.thumbnail) findings.push({ code: "thumbnail" });
  return findings;
}

// 只帶旋轉方向的最小 EXIF 區段。手機直拍的照片多半是橫著存、再用這個欄位標示
// 要轉幾度，整段 EXIF 拿掉之後照片會變成橫的，所以單獨把它寫回去。
export function orientationSegment(orientation: number): Uint8Array {
  const out = new Uint8Array(36);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xffe1);
  view.setUint16(2, 34); // 區段長度，含這兩個位元組
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // "Exif\0\0"
  out.set([0x4d, 0x4d], 10); // 大端序
  view.setUint16(12, 42);
  view.setUint32(14, 8); // IFD0 緊接在標頭後面
  view.setUint16(18, 1); // 一個項目
  view.setUint16(20, 0x0112);
  view.setUint16(22, 3); // SHORT
  view.setUint32(24, 1);
  view.setUint16(28, orientation);
  view.setUint32(32, 0); // 沒有下一個 IFD
  return out;
}

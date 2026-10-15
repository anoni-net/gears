import { ascii, indexOf, isHeifBrand, u16be, u32be } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { exifFindings, parseExif } from "./exif.ts";

// HEIC（HEIF）的中繼資料。iPhone 預設拍出來的就是這個格式。
//
// HEIF 是 box 組成的容器（跟 MP4 同一個家族）。影像與中繼資料都是「item」，meta box 裡的
// iinf 列出每個 item 的類型，iloc 記錄它的資料在檔案的哪個位置。EXIF 是類型 Exif 的
// item，XMP 是 content type 為 application/rdf+xml 的 mime item。
//
// 清除時不刪掉這些 item，那樣要改寫 iloc 裡所有的位移。改成原地把資料換成空白的
// EXIF 與 XMP，長度不變，檔案結構與影像資料一個位元都不動。旋轉方向在 HEIF 裡由
// irot 與 imir 這兩個屬性記錄，跟 EXIF 無關，所以清掉 EXIF 不會讓照片轉向。

interface Box {
  type: string;
  start: number;
  header: number; // box 標頭的長度
  end: number;
}

function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let i = start;
  while (i + 8 <= end) {
    let size = u32be(bytes, i);
    const type = ascii(bytes, i + 4, 4);
    let header = 8;
    if (size === 1) {
      if (i + 16 > end) throw new ToolError("broken");
      const high = u32be(bytes, i + 8);
      size = high * 2 ** 32 + u32be(bytes, i + 12);
      header = 16;
    } else if (size === 0) {
      size = end - i;
    }
    if (size < header || i + size > end) throw new ToolError("broken");
    boxes.push({ type, start: i, header, end: i + size });
    i += size;
  }
  return boxes;
}

export const isHeif = isHeifBrand;

interface MetadataItem {
  kind: "exif" | "xmp";
  start: number; // 資料在檔案裡的位置
  length: number;
}

function readUint(bytes: Uint8Array, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 2) return u16be(bytes, at);
  if (size === 4) return u32be(bytes, at);
  if (size === 8) return u32be(bytes, at) * 2 ** 32 + u32be(bytes, at + 4);
  throw new ToolError("broken");
}

function cString(bytes: Uint8Array, at: number, end: number): [string, number] {
  let i = at;
  while (i < end && bytes[i] !== 0) i++;
  return [new TextDecoder().decode(bytes.subarray(at, i)), i + 1];
}

// 找出 EXIF 與 XMP item 的資料位置
function metadataItems(bytes: Uint8Array): MetadataItem[] {
  const top = readBoxes(bytes, 0, bytes.length);
  const meta = top.find((b) => b.type === "meta");
  if (!meta) return [];
  // meta 是 full box，標頭後面有 4 個位元組的版本與旗標
  const children = readBoxes(bytes, meta.start + meta.header + 4, meta.end);

  const kinds = new Map<number, "exif" | "xmp">();
  const iinf = children.find((b) => b.type === "iinf");
  if (iinf) {
    const version = bytes[iinf.start + iinf.header]!;
    const countSize = version === 0 ? 2 : 4;
    const entriesAt = iinf.start + iinf.header + 4 + countSize;
    for (const infe of readBoxes(bytes, entriesAt, iinf.end)) {
      if (infe.type !== "infe") continue;
      const v = bytes[infe.start + infe.header]!;
      if (v < 2) continue;
      let at = infe.start + infe.header + 4;
      const id = v === 2 ? u16be(bytes, at) : u32be(bytes, at);
      at += v === 2 ? 2 : 4;
      at += 2; // item_protection_index
      const itemType = ascii(bytes, at, 4);
      at += 4;
      const [, afterName] = cString(bytes, at, infe.end);
      if (itemType === "Exif") kinds.set(id, "exif");
      if (itemType === "mime") {
        const [contentType] = cString(bytes, afterName, infe.end);
        if (contentType.startsWith("application/rdf+xml")) kinds.set(id, "xmp");
      }
    }
  }
  if (!kinds.size) return [];

  const iloc = children.find((b) => b.type === "iloc");
  const idat = children.find((b) => b.type === "idat");
  if (!iloc) throw new ToolError("broken");
  const version = bytes[iloc.start + iloc.header]!;
  let at = iloc.start + iloc.header + 4;
  const sizes = u16be(bytes, at);
  at += 2;
  const offsetSize = (sizes >> 12) & 0xf;
  const lengthSize = (sizes >> 8) & 0xf;
  const baseOffsetSize = (sizes >> 4) & 0xf;
  const indexSize = version >= 1 ? sizes & 0xf : 0;
  const count = version < 2 ? u16be(bytes, at) : u32be(bytes, at);
  at += version < 2 ? 2 : 4;

  const items: MetadataItem[] = [];
  for (let n = 0; n < count; n++) {
    if (at >= iloc.end) throw new ToolError("broken");
    const id = version < 2 ? u16be(bytes, at) : u32be(bytes, at);
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version >= 1) {
      method = u16be(bytes, at) & 0xf;
      at += 2;
    }
    at += 2; // data_reference_index
    const base = readUint(bytes, at, baseOffsetSize);
    at += baseOffsetSize;
    const extents = u16be(bytes, at);
    at += 2;
    for (let e = 0; e < extents; e++) {
      at += indexSize;
      const offset = readUint(bytes, at, offsetSize);
      at += offsetSize;
      const length = readUint(bytes, at, lengthSize);
      at += lengthSize;
      const kind = kinds.get(id);
      if (!kind) continue;
      // construction_method 0 是檔案裡的位移，1 是 idat 裡的位移
      let start: number;
      if (method === 0) start = base + offset;
      else if (method === 1 && idat) start = idat.start + idat.header + base + offset;
      else throw new ToolError("unsupported");
      if (start + length > bytes.length) throw new ToolError("broken");
      items.push({ kind, start, length });
    }
  }
  return items;
}

// EXIF item 的資料是 4 個位元組的位移，接著才是 TIFF 結構（中間常有 Exif\0\0）
function tiffOf(bytes: Uint8Array, item: MetadataItem): Uint8Array {
  const skip = u32be(bytes, item.start);
  const at = item.start + 4 + skip;
  return bytes.subarray(Math.min(at, item.start + item.length), item.start + item.length);
}

// 空白的 TIFF：大端序標頭、IFD0 沒有任何項目、沒有下一個 IFD
const EMPTY_TIFF = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const EMPTY_XMP_TEXT = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>';
const EMPTY_XMP = new TextEncoder().encode(EMPTY_XMP_TEXT);

export function inspectHeif(bytes: Uint8Array): Finding[] {
  let items: MetadataItem[];
  try {
    items = metadataItems(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const item of items) {
    if (item.kind === "exif") {
      findings.push(...exifFindings(parseExif(tiffOf(bytes, item))));
    } else {
      const xmp = bytes.subarray(item.start, item.start + item.length);
      // 清除之後留下的空白 xmpmeta 不算一項資訊
      if (new TextDecoder().decode(xmp).trim() === EMPTY_XMP_TEXT) continue;
      findings.push({ code: "xmp" });
      if (indexOf(xmp, "GPSLatitude") >= 0) findings.push({ code: "location" });
    }
  }
  return findings;
}

export function stripHeif(bytes: Uint8Array): RunResult {
  if (!isHeif(bytes)) throw new ToolError("broken");
  const items = metadataItems(bytes);
  const out = new Uint8Array(bytes);
  const removed: RunResult["report"]["removed"] = [];
  for (const item of items) {
    const region = out.subarray(item.start, item.start + item.length);
    if (item.kind === "exif") {
      // 保留前面 4 個位元組的位移與 Exif\0\0，從 TIFF 開始換成空白的結構，其餘補零
      const skip = Math.min(u32be(bytes, item.start), Math.max(0, item.length - 4));
      const tiffAt = 4 + skip;
      if (tiffAt + EMPTY_TIFF.length > item.length) {
        region.fill(0);
      } else {
        region.fill(0, tiffAt);
        region.set(EMPTY_TIFF, tiffAt);
      }
      removed.push({ code: "exif", bytes: item.length });
    } else {
      // XMP 換成空的 xmpmeta，後面補空白，XML 仍然合法
      region.fill(0x20);
      if (EMPTY_XMP.length <= item.length) region.set(EMPTY_XMP, 0);
      removed.push({ code: "xmp", bytes: item.length });
    }
  }
  return { data: out, report: { removed, kept: [{ code: "heif-image" }] } };
}

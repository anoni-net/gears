import { ascii } from "../../core/bytes.ts";
import { type Finding, type ReportItem, type RunResult, ToolError } from "../../core/tool.ts";
import { exifFindings, parseExif } from "./exif.ts";
import { other } from "./preview.ts";

// TIFF：中繼資料與影像結構的標籤放在同一個 IFD 裡。用白名單保留解碼需要的標籤，
// 原地改寫 IFD（項目變少，放得下），被拿掉的標籤如果資料放在 IFD 外面（字串、
// EXIF 與 GPS 的子 IFD、XMP、IPTC），那一段也清成零，不能只拿掉指標，否則內容還留在檔案裡。
// 影像資料的位置不變，不必重新編碼。多頁的 TIFF 每一頁都處理。

// 解碼與呈現需要的標籤
const KEEP = new Set([
  254, 255, 256, 257, 258, 259, 262, 263, 266, 273, 274, 277, 278, 279, 280, 281, 282, 283, 284, 290, 291, 292, 293, 296,
  301, 317, 318, 319, 320, 321, 322, 323, 324, 325, 330, 332, 338, 339, 340, 341, 347, 512, 513, 514, 515, 517, 518, 519, 520,
  521, 529, 530, 531, 532, 34675,
]);

const SUB_IFD_POINTERS = new Set([34665, 34853, 40965]); // Exif、GPS、Interoperability
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

interface Reader {
  bytes: Uint8Array;
  view: DataView;
  little: boolean;
  u16(at: number): number;
  u32(at: number): number;
}

function reader(bytes: Uint8Array): Reader {
  const little = bytes[0] === 0x49;
  if (!little && bytes[0] !== 0x4d) throw new ToolError("broken");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { bytes, view, little, u16: (at) => view.getUint16(at, little), u32: (at) => view.getUint32(at, little) };
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  base: number; // 項目在檔案裡的位置
  size: number; // 資料的位元組數
  at: number; // 資料的位置（4 個位元組以內就在項目裡）
}

function entries(r: Reader, offset: number): { list: Entry[]; next: number } {
  if (offset < 8 || offset + 2 > r.bytes.length) throw new ToolError("broken");
  const count = r.u16(offset);
  if (offset + 2 + count * 12 + 4 > r.bytes.length) throw new ToolError("broken");
  const list: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const base = offset + 2 + i * 12;
    const type = r.u16(base + 2);
    const n = r.u32(base + 4);
    const size = (TYPE_SIZE[type] ?? 1) * n;
    list.push({ tag: r.u16(base), type, count: n, base, size, at: size <= 4 ? base + 8 : r.u32(base + 8) });
  }
  return { list, next: r.u32(offset + 2 + count * 12) };
}

// 把一個被拿掉的子 IFD（EXIF、GPS）連同它放在外面的資料清成零
function wipeIfd(r: Reader, offset: number, seen: Set<number>, depth = 0) {
  if (depth > 4 || seen.has(offset) || offset < 8 || offset + 2 > r.bytes.length) return;
  seen.add(offset);
  let parsed: ReturnType<typeof entries>;
  try {
    parsed = entries(r, offset);
  } catch {
    return;
  }
  for (const e of parsed.list) {
    if (SUB_IFD_POINTERS.has(e.tag)) wipeIfd(r, r.u32(e.at), seen, depth + 1);
    if (e.size > 4 && e.at + e.size <= r.bytes.length) r.bytes.fill(0, e.at, e.at + e.size);
  }
  r.bytes.fill(0, offset, offset + 2 + parsed.list.length * 12 + 4);
}

function ifdOffsets(r: Reader): number[] {
  const offsets: number[] = [];
  const seen = new Set<number>();
  const queue = [r.u32(4)];
  while (queue.length && offsets.length < 256) {
    const offset = queue.shift()!;
    if (!offset || seen.has(offset)) continue;
    seen.add(offset);
    const { list, next } = entries(r, offset);
    offsets.push(offset);
    queue.push(next);
    // SubIFDs（縮圖或其他解析度）也是影像，一樣要清
    const sub = list.find((e) => e.tag === 330);
    if (sub) for (let i = 0; i < sub.count; i++) queue.push(r.u32(sub.at + i * 4));
  }
  return offsets;
}

export function stripTiff(input: Uint8Array): RunResult {
  if (input.length < 8) throw new ToolError("broken");
  const bytes = new Uint8Array(input);
  const r = reader(bytes);
  if (r.u16(2) !== 42) throw new ToolError("broken");
  const offsets = ifdOffsets(r);
  if (!offsets.length) throw new ToolError("broken");
  const wiped = new Set<number>();
  let removedBytes = 0;
  let removedTags = 0;

  for (const offset of offsets) {
    const { list, next } = entries(r, offset);
    const kept = list.filter((e) => KEEP.has(e.tag));
    for (const e of list) {
      if (KEEP.has(e.tag)) continue;
      removedTags++;
      if (SUB_IFD_POINTERS.has(e.tag)) wipeIfd(r, r.u32(e.at), wiped);
      if (e.size > 4 && e.at + e.size <= bytes.length) {
        bytes.fill(0, e.at, e.at + e.size);
        removedBytes += e.size;
      }
    }
    // 原地改寫：先把保留的項目複製出來，再整段重寫，剩下的空間補零
    const keptBytes = kept.map((e) => bytes.slice(e.base, e.base + 12));
    const oldLength = 2 + list.length * 12 + 4;
    bytes.fill(0, offset, offset + oldLength);
    r.view.setUint16(offset, kept.length, r.little);
    keptBytes.forEach((entry, i) => bytes.set(entry, offset + 2 + i * 12));
    r.view.setUint32(offset + 2 + kept.length * 12, next, r.little);
    removedBytes += (list.length - kept.length) * 12;
  }

  const removed: ReportItem[] = removedTags ? [{ code: "tiff-tags", count: removedTags, bytes: removedBytes }] : [];
  return { data: bytes, report: { removed, kept: [{ code: "tiff-image" }] } };
}

// 描述欄位：ImageDescription、DocumentName、PageName、HostComputer
const TEXT_TAGS: Record<number, Finding["code"]> = { 270: "comment", 269: "text", 285: "text", 316: "device" };

export function inspectTiff(bytes: Uint8Array): Finding[] {
  let r: Reader;
  let offsets: number[];
  try {
    r = reader(bytes);
    offsets = ifdOffsets(r);
  } catch {
    return [];
  }
  // 位置、型號、時間等跟 JPEG 的 EXIF 同一套讀法。TIFF 的第二個 IFD 是下一頁，不是縮圖
  const findings = exifFindings(parseExif(bytes)).filter((f) => f.code !== "thumbnail");
  for (const offset of offsets) {
    for (const e of entries(r, offset).list) {
      if (KEEP.has(e.tag)) continue;
      const code = TEXT_TAGS[e.tag];
      if (code && e.type === 2) {
        const value = ascii(bytes, e.at, Math.min(80, e.count)).replace(/\0.*$/s, "").trim();
        if (value) findings.push({ code, value });
      } else if (e.tag === 700) findings.push({ code: "xmp" });
      else if (e.tag === 33723) findings.push({ code: "iptc" });
      else if (![271, 272, 305, 306, 315, 33432, 34665, 34853].includes(e.tag))
        findings.push(other(`tag ${e.tag}`, e.at + e.size <= bytes.length ? bytes.subarray(e.at, e.at + Math.min(e.size, 4096)) : undefined));
    }
  }
  return findings;
}

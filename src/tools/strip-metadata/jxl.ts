import { ascii, concat, u32be } from "../../core/bytes.ts";
import { type Finding, type ReportItem, type RunResult, ToolError } from "../../core/tool.ts";
import { exifFindings, parseExif, tiffStart } from "./exif.ts";
import { other } from "./preview.ts";

// JPEG XL：只有編碼資料的「裸」格式沒有中繼資料。容器格式由 box 組成，EXIF（Exif）、
// XMP（xml ）與 JUMBF（jumb）是獨立的 box，可能用 brotli 壓縮後包在 brob 裡。
// 這些 box 整個拿掉，其他 box 照抄，box 之間沒有位移關係，不必改寫。

const REMOVE = new Set(["Exif", "xml ", "jumb", "brob"]);

interface Box {
  type: string;
  start: number;
  header: number;
  end: number;
}

function walk(bytes: Uint8Array): Box[] | null {
  if (bytes[0] === 0xff && bytes[1] === 0x0a) return null; // 裸格式
  const boxes: Box[] = [];
  let i = 0;
  while (i + 8 <= bytes.length) {
    let size = u32be(bytes, i);
    let header = 8;
    if (size === 1) {
      size = u32be(bytes, i + 8) * 2 ** 32 + u32be(bytes, i + 12);
      header = 16;
    } else if (size === 0) {
      size = bytes.length - i;
    }
    if (size < header || i + size > bytes.length) throw new ToolError("broken");
    boxes.push({ type: ascii(bytes, i + 4, 4), start: i, header, end: i + size });
    i += size;
  }
  if (boxes[0]?.type !== "JXL ") throw new ToolError("broken");
  return boxes;
}

const removedCode = (b: Box): ReportItem["code"] => (b.type === "Exif" ? "exif" : b.type === "xml " ? "xmp" : "other");

export function stripJxl(bytes: Uint8Array): RunResult {
  const boxes = walk(bytes);
  if (!boxes) return { data: bytes.slice(), report: { removed: [], kept: [{ code: "jxl-image" }] } };
  const parts: Uint8Array[] = [];
  const removed: ReportItem[] = [];
  for (const b of boxes) {
    if (REMOVE.has(b.type)) removed.push({ code: removedCode(b), bytes: b.end - b.start });
    else parts.push(bytes.subarray(b.start, b.end));
  }
  return { data: concat(parts), report: { removed, kept: [{ code: "jxl-image" }] } };
}

export function inspectJxl(bytes: Uint8Array): Finding[] {
  let boxes: Box[] | null;
  try {
    boxes = walk(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const b of boxes ?? []) {
    if (b.type === "Exif") {
      const at = b.start + b.header;
      findings.push(...exifFindings(parseExif(bytes.subarray(at + tiffStart(bytes, at, b.end), b.end))));
    } else if (b.type === "xml ") findings.push({ code: "xmp" });
    else if (REMOVE.has(b.type)) findings.push(other(b.type.trim(), bytes.subarray(b.start + b.header, b.end)));
  }
  return findings;
}

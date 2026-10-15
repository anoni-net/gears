import { ascii, concat, indexOf, startsWith, u32le } from "../../core/bytes.ts";
import { type Finding, type ReportItem, type RunResult, ToolError } from "../../core/tool.ts";
import { exifFindings, parseExif } from "./exif.ts";
import { other } from "./preview.ts";

// WebP：RIFF 容器，chunk 是「代號(4) 長度(4，小端序) 資料」，長度是奇數時補一個位元組。
// 影像、透明度、動畫與色彩描述檔的 chunk 保留，EXIF、XMP 與不認得的拿掉。延伸格式的
// VP8X 有旗標標示檔案裡有沒有 EXIF 與 XMP，拿掉之後要一起清掉，RIFF 的總長度也要重算。

const KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF", "ICCP"]);

interface Chunk {
  type: string;
  start: number;
  data: number;
  size: number;
  end: number;
}

function walk(bytes: Uint8Array): Chunk[] {
  if (bytes.length < 12 || !startsWith(bytes, 0, "RIFF") || !startsWith(bytes, 8, "WEBP")) throw new ToolError("broken");
  const riffEnd = Math.min(bytes.length, 8 + u32le(bytes, 4));
  const chunks: Chunk[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const size = u32le(bytes, i + 4);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > bytes.length) throw new ToolError("broken");
    chunks.push({ type: ascii(bytes, i, 4), start: i, data: i + 8, size, end: Math.min(end, bytes.length) });
    i = end;
  }
  if (!chunks.some((c) => c.type === "VP8 " || c.type === "VP8L" || c.type === "ANIM")) throw new ToolError("broken");
  return chunks;
}

// EXIF chunk 的內容有時會帶 Exif\0\0 的前綴
function tiffOf(bytes: Uint8Array, c: Chunk) {
  const at = startsWith(bytes, c.data, "Exif\0\0") ? c.data + 6 : c.data;
  return bytes.subarray(at, c.data + c.size);
}

export function stripWebp(bytes: Uint8Array): RunResult {
  const chunks = walk(bytes);
  const parts: Uint8Array[] = [];
  const removed: ReportItem[] = [];
  for (const c of chunks) {
    if (!KEEP.has(c.type)) {
      removed.push({ code: c.type === "EXIF" ? "exif" : c.type === "XMP " ? "xmp" : "other", bytes: c.end - c.start });
      continue;
    }
    const chunk = bytes.slice(c.start, c.end);
    // VP8X 的旗標：0x08 是 EXIF、0x04 是 XMP
    if (c.type === "VP8X") chunk[8] = chunk[8]! & ~0x0c;
    parts.push(chunk);
  }
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set(bytes.subarray(0, 12));
  new DataView(head.buffer).setUint32(4, 4 + body.length, true);
  return { data: concat([head, body]), report: { removed, kept: [] } };
}

export function inspectWebp(bytes: Uint8Array): Finding[] {
  let chunks: Chunk[];
  try {
    chunks = walk(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const c of chunks) {
    if (KEEP.has(c.type)) continue;
    if (c.type === "EXIF") findings.push(...exifFindings(parseExif(tiffOf(bytes, c))));
    else if (c.type === "XMP ") {
      findings.push({ code: "xmp" });
      if (indexOf(bytes.subarray(c.data, c.data + c.size), "GPSLatitude") >= 0) findings.push({ code: "location" });
    } else findings.push(other(c.type.trim(), bytes.subarray(c.data, c.data + c.size)));
  }
  return findings;
}

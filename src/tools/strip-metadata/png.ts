import { ascii, concat, startsWith, u32be } from "../../core/bytes.ts";
import { type Finding, type ReportItem, type RunResult, type SegmentCode, ToolError } from "../../core/tool.ts";
import { exifFindings, parseExif } from "./exif.ts";
import { other } from "./preview.ts";

// PNG 由 chunk 組成：長度(4) 型別(4) 資料 CRC(4)。每個 chunk 各自帶 CRC，整個拿掉
// 不影響其他 chunk，不必重算。解碼與顏色需要的 chunk 用白名單保留，其他一律拿掉，
// 包含沒見過的私有 chunk。IEND 之後的附加資料也拿掉。

const KEEP = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS",
  // 顏色與呈現
  "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "mDCV", "cLLI", "bKGD", "pHYs",
  // APNG 動畫
  "acTL", "fcTL", "fdAT",
]);

interface Chunk {
  type: string;
  start: number;
  end: number;
  data: number; // 資料開始的位置
  length: number;
}

function walk(bytes: Uint8Array): { chunks: Chunk[]; trailer: number } {
  const chunks: Chunk[] = [];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = u32be(bytes, i);
    const end = i + 12 + length;
    if (end > bytes.length) throw new ToolError("broken");
    const type = ascii(bytes, i + 4, 4);
    chunks.push({ type, start: i, end, data: i + 8, length });
    i = end;
    if (type === "IEND") return { chunks, trailer: i };
  }
  throw new ToolError("broken");
}

function isXmp(bytes: Uint8Array, c: Chunk) {
  return c.type === "iTXt" && startsWith(bytes, c.data, "XML:com.adobe.xmp\0");
}

function removedCode(bytes: Uint8Array, c: Chunk): SegmentCode {
  if (isXmp(bytes, c)) return "xmp";
  switch (c.type) {
    case "tEXt":
    case "zTXt":
    case "iTXt":
      return "text";
    case "tIME":
      return "time";
    case "eXIf":
      return "exif";
    default:
      return "other";
  }
}

export function stripPng(bytes: Uint8Array): RunResult {
  const { chunks, trailer } = walk(bytes);
  if (chunks[0]?.type !== "IHDR") throw new ToolError("broken");
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: ReportItem[] = [];
  for (const c of chunks) {
    if (KEEP.has(c.type)) {
      parts.push(bytes.subarray(c.start, c.end));
    } else {
      removed.push({ code: removedCode(bytes, c), bytes: c.end - c.start });
    }
  }
  if (trailer < bytes.length) removed.push({ code: "trailer", bytes: bytes.length - trailer });
  return { data: concat(parts), report: { removed, kept: [] } };
}

// tEXt 的關鍵字對應到比較具體的類別，其他的列成一般的文字欄位。
const TEXT_KEYWORDS: Record<string, Finding["code"]> = {
  Author: "owner",
  Copyright: "owner",
  Software: "software",
  "Creation Time": "datetime",
  Source: "device",
};

export function inspectPng(bytes: Uint8Array): Finding[] {
  let result: { chunks: Chunk[]; trailer: number };
  try {
    result = walk(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const c of result.chunks) {
    if (KEEP.has(c.type)) continue;
    if (isXmp(bytes, c)) {
      findings.push({ code: "xmp" });
      continue;
    }
    switch (c.type) {
      case "tEXt":
      case "zTXt":
      case "iTXt": {
        const zero = bytes.subarray(c.data, c.data + Math.min(c.length, 80)).indexOf(0);
        const keyword = zero > 0 ? ascii(bytes, c.data, zero) : "";
        let value: string | undefined;
        if (c.type === "tEXt" && zero > 0) {
          value = ascii(bytes, c.data + zero + 1, Math.min(80, c.length - zero - 1)).trim() || undefined;
        }
        const code = TEXT_KEYWORDS[keyword] ?? "text";
        findings.push({ code, value: code === "text" ? keyword || undefined : value });
        break;
      }
      case "tIME":
        findings.push({ code: "datetime" });
        break;
      case "eXIf":
        findings.push(...exifFindings(parseExif(bytes.subarray(c.data, c.data + c.length))));
        break;
      default:
        findings.push(other(c.type, bytes.subarray(c.data, c.data + c.length)));
    }
  }
  if (result.trailer < bytes.length) findings.push({ code: "trailer" });
  return findings;
}

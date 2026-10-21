import { ascii, concat } from "../../core/bytes.ts";
import { type Finding, type ReportItem, type RunResult, ToolError } from "../../core/tool.ts";
import { other } from "./preview.ts";

// GIF：標頭與調色盤之後是一連串的區塊。影像（0x2C）與控制動畫的延伸區塊照抄，
// 註解（0xFE）與不認得的應用程式延伸（XMP 也放在這裡）拿掉。迴圈次數
// （NETSCAPE2.0、ANIMEXTS1.0）與色彩描述檔（ICCRGBG1012）保留，拿掉的話動畫不會
// 重播、顏色會偏。結束標記（0x3B）之後的附加資料也拿掉。

const KEEP_APPS = ["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"];

interface Block {
  kind: "image" | "gce" | "plain" | "comment" | "app" | "unknown";
  start: number;
  end: number;
  app?: string;
}

// 子區塊：長度一個位元組，接著那麼多位元組的資料，長度為 0 時結束
function skipSubBlocks(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i < bytes.length) {
    const size = bytes[i]!;
    i += 1 + size;
    if (size === 0) return i;
  }
  throw new ToolError("broken");
}

function walk(bytes: Uint8Array): { headerEnd: number; blocks: Block[]; trailer: number } {
  if (bytes.length < 13) throw new ToolError("broken");
  const flags = bytes[10]!;
  let i = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0);
  const headerEnd = i;
  const blocks: Block[] = [];
  while (i < bytes.length) {
    const marker = bytes[i]!;
    if (marker === 0x3b) return { headerEnd, blocks, trailer: i + 1 };
    if (marker === 0x2c) {
      if (i + 10 > bytes.length) throw new ToolError("broken");
      const lct = bytes[i + 9]!;
      const dataAt = i + 10 + (lct & 0x80 ? 3 * 2 ** ((lct & 7) + 1) : 0) + 1; // 加上 LZW 最小碼長
      const end = skipSubBlocks(bytes, dataAt);
      blocks.push({ kind: "image", start: i, end });
      i = end;
    } else if (marker === 0x21) {
      const label = bytes[i + 1];
      const end = skipSubBlocks(bytes, i + 2);
      if (label === 0xf9) blocks.push({ kind: "gce", start: i, end });
      else if (label === 0x01) blocks.push({ kind: "plain", start: i, end });
      else if (label === 0xfe) blocks.push({ kind: "comment", start: i, end });
      else if (label === 0xff) blocks.push({ kind: "app", start: i, end, app: ascii(bytes, i + 3, bytes[i + 2]!) });
      else blocks.push({ kind: "unknown", start: i, end });
      i = end;
    } else {
      throw new ToolError("broken");
    }
  }
  throw new ToolError("broken");
}

const keep = (b: Block) => b.kind === "image" || b.kind === "gce" || b.kind === "plain" || (b.kind === "app" && KEEP_APPS.includes(b.app!));

export function stripGif(bytes: Uint8Array): RunResult {
  const { headerEnd, blocks, trailer } = walk(bytes);
  const parts = [bytes.subarray(0, headerEnd)];
  const removed: ReportItem[] = [];
  for (const b of blocks) {
    if (keep(b)) parts.push(bytes.subarray(b.start, b.end));
    else removed.push({ code: b.kind === "comment" ? "comment" : b.app?.startsWith("XMP Data") ? "xmp" : b.app?.startsWith("C2PA_GIF") ? "c2pa" : "app", bytes: b.end - b.start });
  }
  parts.push(new Uint8Array([0x3b]));
  if (trailer < bytes.length) removed.push({ code: "trailer", bytes: bytes.length - trailer });
  return { data: concat(parts), report: { removed, kept: [] } };
}

export function inspectGif(bytes: Uint8Array): Finding[] {
  let result: ReturnType<typeof walk>;
  try {
    result = walk(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const b of result.blocks) {
    if (keep(b)) continue;
    if (b.kind === "comment") {
      const text = ascii(bytes, b.start + 3, Math.min(80, bytes[b.start + 2]!)).replace(/[^\x20-\x7e]/g, "").trim();
      findings.push({ code: "comment", value: text || undefined });
    } else if (b.app?.startsWith("XMP Data")) {
      findings.push({ code: "xmp" });
    } else if (b.app?.startsWith("C2PA_GIF")) {
      findings.push({ code: "c2pa" });
    } else {
      findings.push(other(b.app?.trim() || "extension", bytes.subarray(b.start, b.end)));
    }
  }
  if (result.trailer < bytes.length) findings.push({ code: "trailer" });
  return findings;
}

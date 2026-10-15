import { concat, startsWith } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { id3v2Size } from "../../core/media.ts";
import { id3v1Findings, id3v2Findings } from "./id3.ts";
import { vorbisCommentFindings } from "./media-tags.ts";
import { Tally } from "./package.ts";

// FLAC：「fLaC」之後是一串描述區塊，接著是音訊框。保留解碼需要的 STREAMINFO、
// 搜尋表（SEEKTABLE）與 CD 曲目表（CUESHEET），標籤（VORBIS_COMMENT）、封面
// （PICTURE）、程式自訂的區塊（APPLICATION）與填充拿掉。有些標籤軟體會在開頭加上
// ID3v2、檔尾加上 ID3v1，一併拿掉。

const KEEP = new Set([0, 3, 5]);

interface Block {
  type: number;
  start: number;
  end: number;
}

function layout(bytes: Uint8Array) {
  const start = id3v2Size(bytes, 0);
  if (!startsWith(bytes, start, "fLaC")) throw new ToolError("broken");
  const blocks: Block[] = [];
  let at = start + 4;
  for (;;) {
    if (at + 4 > bytes.length) throw new ToolError("broken");
    const header = bytes[at]!;
    const end = at + 4 + ((bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!);
    if (end > bytes.length || (header & 0x7f) === 127) throw new ToolError("broken");
    blocks.push({ type: header & 0x7f, start: at, end });
    at = end;
    if (header & 0x80) break;
  }
  if (blocks[0]?.type !== 0) throw new ToolError("broken");
  const v1 = bytes.length - 128 > at && startsWith(bytes, bytes.length - 128, "TAG");
  return { start, blocks, audio: at, end: v1 ? bytes.length - 128 : bytes.length };
}

export function stripFlac(bytes: Uint8Array): RunResult {
  const { start, blocks, audio, end } = layout(bytes);
  const tally = new Tally();
  if (start || end < bytes.length) tally.add("media-tags");
  const kept = blocks.filter((b) => KEEP.has(b.type)).map((b) => bytes.slice(b.start, b.end));
  for (const b of blocks) {
    if (b.type === 4 || b.type === 6) tally.add("media-tags");
    else if (b.type === 2) tally.add("other");
  }
  kept.forEach((block, i) => (block[0] = (block[0]! & 0x7f) | (i === kept.length - 1 ? 0x80 : 0)));
  const data = concat([bytes.subarray(start, start + 4), ...kept, bytes.subarray(audio, end)]);
  return { data, report: { removed: tally.items(), kept: [{ code: "media-stream" }] } };
}

export function inspectFlac(bytes: Uint8Array): Finding[] {
  let parts: ReturnType<typeof layout>;
  try {
    parts = layout(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = parts.start ? id3v2Findings(bytes, 0) : [];
  for (const b of parts.blocks) {
    if (b.type === 4) findings.push(...vorbisCommentFindings(bytes, b.start + 4, b.end));
    else if (b.type === 6) findings.push({ code: "thumbnail" });
    else if (b.type === 2) findings.push({ code: "other" });
  }
  if (parts.end < bytes.length) findings.push(...id3v1Findings(bytes, parts.end));
  return findings;
}

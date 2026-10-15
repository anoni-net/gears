import { concat, startsWith, u32le } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { type OggCodec, oggCodec } from "../../core/media.ts";
import { vorbisCommentFindings } from "./media-tags.ts";
import { Tally } from "./package.ts";

// Ogg Vorbis 與 Opus。Ogg 把資料切成「頁」，每頁有序號與 CRC。開頭的幾個封包是標頭：
// Vorbis 有三個（識別、註解、解碼設定），Opus 有兩個（OpusHead、OpusTags）。標籤、封面與
// 編碼程式的名稱都在註解封包裡。
//
// 換成空白的註解封包之後，標頭佔的頁數可能變少，後面每一頁的序號要重新編、CRC 要重算，
// 聲音資料本身不動。只處理單一串流的檔案，多個串流交錯（例如 Ogg 影片）或串接的檔案不處理。

interface Page {
  start: number;
  end: number;
  flags: number;
  serial: number;
  segments: number[];
  body: number; // 資料開始的位置
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(page: Uint8Array): number {
  let crc = 0;
  for (const b of page) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc;
}

function readPages(bytes: Uint8Array): Page[] {
  const pages: Page[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 27 > bytes.length || !startsWith(bytes, at, "OggS") || bytes[at + 4] !== 0) throw new ToolError("broken");
    const count = bytes[at + 26]!;
    const segments = [...bytes.subarray(at + 27, at + 27 + count)];
    const body = at + 27 + count;
    const end = body + segments.reduce((n, s) => n + s, 0);
    if (end > bytes.length) throw new ToolError("broken");
    pages.push({ start: at, end, flags: bytes[at + 5]!, serial: u32le(bytes, at + 14), segments, body });
    at = end;
  }
  return pages;
}

interface Headers {
  codec: OggCodec;
  packets: Uint8Array[]; // 標頭封包
  nextPage: number; // 聲音資料從第幾頁開始
  pages: Page[];
}

function headers(bytes: Uint8Array): Headers {
  const codec = oggCodec(bytes);
  if (!codec) throw new ToolError("unsupported");
  const pages = readPages(bytes);
  const serial = pages[0]!.serial;
  // 多個串流或串接的檔案
  if (pages.some((p, i) => p.serial !== serial || (i > 0 && p.flags & 0x02))) throw new ToolError("unsupported");
  const need = codec === "vorbis" ? 3 : 2;
  const packets: Uint8Array[] = [];
  let current: Uint8Array[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    let at = page.body;
    for (const [k, size] of page.segments.entries()) {
      current.push(bytes.subarray(at, at + size));
      at += size;
      if (size < 255) {
        packets.push(concat(current));
        current = [];
        // 識別封包規定單獨放在第一頁，這裡直接沿用那一頁
        if (packets.length === 1 && (i !== 0 || k !== page.segments.length - 1)) throw new ToolError("unsupported");
        if (packets.length === need) {
          // 標頭之後的聲音資料規定從新的一頁開始
          if (k !== page.segments.length - 1) throw new ToolError("unsupported");
          return { codec, packets, nextPage: i + 1, pages };
        }
      }
    }
  }
  throw new ToolError("broken");
}

// 一頁最多 255 段，每段最多 255 位元組
function paginate(packets: Uint8Array[], serial: number, firstSequence: number): Uint8Array[] {
  const lacing: number[] = [];
  const data: Uint8Array[] = [];
  for (const packet of packets) {
    for (let n = packet.length; ; n -= 255) {
      lacing.push(Math.min(255, n));
      if (n < 255) break;
    }
    data.push(packet);
  }
  const body = concat(data);
  const pages: Uint8Array[] = [];
  let offset = 0;
  let continued = false;
  for (let i = 0; i < lacing.length; i += 255) {
    const segments = lacing.slice(i, i + 255);
    const size = segments.reduce((n, s) => n + s, 0);
    const page = new Uint8Array(27 + segments.length + size);
    const view = new DataView(page.buffer);
    page.set([0x4f, 0x67, 0x67, 0x53, 0, continued ? 1 : 0]);
    view.setUint32(14, serial, true);
    view.setUint32(18, firstSequence + pages.length, true);
    page[26] = segments.length;
    page.set(segments, 27);
    page.set(body.subarray(offset, offset + size), 27 + segments.length);
    view.setUint32(22, oggCrc(page), true);
    pages.push(page);
    offset += size;
    continued = segments.at(-1) === 255;
  }
  return pages;
}

const EMPTY_TAGS: Record<OggCodec, Uint8Array> = {
  // 封包類型、vendor 長度 0、筆數 0、Vorbis 結尾的 framing bit
  vorbis: new Uint8Array([3, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
  opus: new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73, 0, 0, 0, 0, 0, 0, 0, 0]),
};

export function stripOgg(bytes: Uint8Array): RunResult {
  const { codec, packets, nextPage, pages } = headers(bytes);
  const serial = pages[0]!.serial;
  const head = paginate([EMPTY_TAGS[codec], ...packets.slice(2)], serial, 1);
  const rest = pages.slice(nextPage).map((p, i) => {
    const page = bytes.slice(p.start, p.end);
    const view = new DataView(page.buffer);
    view.setUint32(18, 1 + head.length + i, true);
    view.setUint32(22, 0, true);
    view.setUint32(22, oggCrc(page), true);
    return page;
  });
  const tally = new Tally();
  tally.add("media-tags");
  return {
    data: concat([bytes.subarray(pages[0]!.start, pages[0]!.end), ...head, ...rest]),
    report: { removed: tally.items(), kept: [{ code: "media-stream" }] },
  };
}

export function inspectOgg(bytes: Uint8Array): Finding[] {
  let parsed: Headers;
  try {
    parsed = headers(bytes);
  } catch {
    return [];
  }
  const comment = parsed.packets[1]!;
  const skip = parsed.codec === "vorbis" ? 7 : 8;
  return vorbisCommentFindings(comment, skip, comment.length);
}

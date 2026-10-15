import { startsWith, u32le } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { findMp3Frame, id3v2Size } from "../../core/media.ts";
import { id3v1Findings, id3v2Findings } from "./id3.ts";
import { Tally } from "./package.ts";
import { other } from "./preview.ts";

// MP3：聲音資料是一連串的 MPEG 音訊框，標籤接在前後。開頭是 ID3v2（標題、演出者、封面、
// 註解、編碼軟體與各種私有欄位），檔尾可能有 ID3v1、APEv2 與 Lyrics3。這些全部拿掉，
// 音訊框原樣保留。第一個音訊框裡的 Xing／LAME 標頭記錄長度與無縫播放的資訊，留著。

interface Layout {
  start: number; // 第一個 ID3v2 之後
  end: number; // 檔尾的標籤之前
  head: number; // 開頭幾個 ID3v2
  tail: { kind: "id3v1" | "ape" | "lyrics"; at: number }[]; // 檔尾有哪些標籤
}

function layout(bytes: Uint8Array): Layout {
  let start = 0;
  let head = 0;
  for (let size = id3v2Size(bytes, 0); size; size = id3v2Size(bytes, start)) {
    start += size;
    head++;
  }
  let end = bytes.length;
  const tail: Layout["tail"] = [];
  for (;;) {
    if (end - 128 >= start && startsWith(bytes, end - 128, "TAG")) {
      tail.push({ kind: "id3v1", at: end - 128 });
      end -= startsWith(bytes, end - 355, "TAG+") ? 355 : 128;
    } else if (end - 32 >= start && startsWith(bytes, end - 32, "APETAGEX")) {
      const size = u32le(bytes, end - 32 + 12);
      const header = u32le(bytes, end - 32 + 20) & 0x80000000 ? 32 : 0;
      if (size + header > end - start) throw new ToolError("broken");
      end -= size + header;
      tail.push({ kind: "ape", at: end });
    } else if (end - 15 >= start && startsWith(bytes, end - 9, "LYRICS200")) {
      const size = Number(new TextDecoder().decode(bytes.subarray(end - 15, end - 9)));
      if (!Number.isFinite(size) || size + 15 > end - start) throw new ToolError("broken");
      end -= size + 15;
      tail.push({ kind: "lyrics", at: end });
    } else break;
  }
  return { start, end, head, tail };
}

export function stripMp3(bytes: Uint8Array): RunResult {
  const { start, end, head, tail } = layout(bytes);
  if (findMp3Frame(bytes.subarray(0, end), start) < 0) throw new ToolError("broken");
  const tally = new Tally();
  if (head || tail.length) tally.add("media-tags");
  return { data: bytes.slice(start, end), report: { removed: tally.items(), kept: [{ code: "media-stream" }] } };
}

export function inspectMp3(bytes: Uint8Array): Finding[] {
  let parts: Layout;
  try {
    parts = layout(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (let at = 0; at < parts.start; at += id3v2Size(bytes, at)) findings.push(...id3v2Findings(bytes, at));
  for (const { kind, at } of parts.tail) {
    if (kind === "id3v1") findings.push(...id3v1Findings(bytes, at));
    else findings.push(other(kind === "ape" ? "APEv2" : "Lyrics3", bytes.subarray(at, at + 4096)));
  }
  return findings;
}

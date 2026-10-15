import { concat } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";

// PNM（PBM、PGM、PPM）與 PAM：文字檔頭裡可以有 # 開頭的註解，GIMP 這類程式會寫進
// 「Created by …」。P1 到 P3 整份都是文字，註解可以出現在任何地方，P4 到 P6 只在檔頭裡。
// 拿掉註解，其餘的數值與影像資料原樣保留。

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;

interface Parsed {
  headerEnd: number; // 影像資料開始的位置
  comments: { start: number; end: number; text: string }[];
}

function parse(bytes: Uint8Array): Parsed {
  if (bytes.length < 3 || bytes[0] !== 0x50) throw new ToolError("broken");
  const kind = bytes[1]! - 0x30;
  if (kind < 1 || kind > 7) throw new ToolError("broken");
  const comments: Parsed["comments"] = [];
  const decoder = new TextDecoder();
  // 掃過檔頭：P7 讀到 ENDHDR 那一行，其他讀到第 N 個數值（P1、P4 沒有最大值）
  const needed = kind === 1 || kind === 4 ? 2 : 3;
  let i = 2;
  let values = 0;
  const ascii = kind <= 3;
  while (i < bytes.length) {
    const c = bytes[i]!;
    if (c === 0x23) {
      let end = i;
      while (end < bytes.length && bytes[end] !== 0x0a && bytes[end] !== 0x0d) end++;
      comments.push({ start: i, end, text: decoder.decode(bytes.subarray(i + 1, end)).trim() });
      i = end;
      continue;
    }
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (kind === 7) {
      let end = i;
      while (end < bytes.length && bytes[end] !== 0x0a) end++;
      const line = decoder.decode(bytes.subarray(i, end)).trim();
      i = end + 1;
      if (line === "ENDHDR") return { headerEnd: i, comments };
      continue;
    }
    if (values === needed) {
      // 文字格式的註解可能出現在資料裡，繼續掃到底
      if (!ascii) break;
      i++;
      continue;
    }
    while (i < bytes.length && !isSpace(bytes[i]!) && bytes[i] !== 0x23) i++;
    values++;
    // 二進位格式：最後一個數值後面恰好一個空白字元，接著就是影像資料
    if (values === needed && !ascii) return { headerEnd: i + 1, comments };
  }
  if (kind === 7) throw new ToolError("broken");
  return { headerEnd: bytes.length, comments };
}

export function stripPnm(bytes: Uint8Array): RunResult {
  const { comments } = parse(bytes);
  const parts: Uint8Array[] = [];
  let at = 0;
  for (const c of comments) {
    parts.push(bytes.subarray(at, c.start));
    at = c.end;
  }
  parts.push(bytes.subarray(at));
  const removed = comments.length ? [{ code: "comment" as const, count: comments.length }] : [];
  return { data: concat(parts), report: { removed, kept: [] } };
}

export function inspectPnm(bytes: Uint8Array): Finding[] {
  try {
    return parse(bytes).comments.map((c) => ({ code: "comment" as const, value: c.text.slice(0, 80) || undefined }));
  } catch {
    return [];
  }
}

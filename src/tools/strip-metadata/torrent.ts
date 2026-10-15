import { concat } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { Tally } from "./package.ts";
import { other } from "./preview.ts";

// BitTorrent 的種子檔（bencode）。最上層除了 info（檔案清單與雜湊，改了就是另一個種子）
// 與 tracker 的網址，還有建立的程式、建立時間、註解與發布者。只留下載需要的欄位。

const KEEP = new Set(["announce", "announce-list", "info", "url-list", "httpseeds", "nodes", "encoding"]);

// 回傳 bencode 值結束的位置
function skip(bytes: Uint8Array, at: number, depth = 0): number {
  if (depth > 64 || at >= bytes.length) throw new ToolError("broken");
  const c = bytes[at]!;
  if (c === 0x69) {
    const end = bytes.indexOf(0x65, at);
    if (end < 0) throw new ToolError("broken");
    return end + 1;
  }
  if (c === 0x6c || c === 0x64) {
    let i = at + 1;
    while (bytes[i] !== 0x65) {
      if (i >= bytes.length) throw new ToolError("broken");
      i = skip(bytes, i, depth + 1);
    }
    return i + 1;
  }
  if (c >= 0x30 && c <= 0x39) {
    const colon = bytes.indexOf(0x3a, at);
    const length = Number(new TextDecoder().decode(bytes.subarray(at, colon)));
    if (colon < 0 || !Number.isInteger(length) || colon + 1 + length > bytes.length) throw new ToolError("broken");
    return colon + 1 + length;
  }
  throw new ToolError("broken");
}

interface Field {
  key: string;
  start: number; // 鍵的開始
  value: number; // 值的開始
  end: number;
}

function fields(bytes: Uint8Array): { list: Field[]; end: number } {
  if (bytes[0] !== 0x64) throw new ToolError("broken");
  const list: Field[] = [];
  let at = 1;
  while (bytes[at] !== 0x65) {
    if (at >= bytes.length) throw new ToolError("broken");
    const value = skip(bytes, at);
    const colon = bytes.indexOf(0x3a, at);
    const end = skip(bytes, value);
    list.push({ key: new TextDecoder().decode(bytes.subarray(colon + 1, value)), start: at, value, end });
    at = end;
  }
  if (!list.some((f) => f.key === "info" && bytes[f.value] === 0x64)) throw new ToolError("broken");
  return { list, end: at + 1 };
}


export function stripTorrent(bytes: Uint8Array): RunResult {
  const { list, end } = fields(bytes);
  const tally = new Tally();
  const kept = list.filter((f) => {
    if (KEEP.has(f.key)) return true;
    tally.add("torrent-info");
    return false;
  });
  if (end < bytes.length) tally.add("trailer");
  const data = concat([new Uint8Array([0x64]), ...kept.map((f) => bytes.subarray(f.start, f.end)), new Uint8Array([0x65])]);
  return { data, report: { removed: tally.items(), kept: [{ code: "torrent-files" }] } };
}

export function inspectTorrent(bytes: Uint8Array): Finding[] {
  let parsed: ReturnType<typeof fields>;
  try {
    parsed = fields(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const f of parsed.list) {
    if (KEEP.has(f.key)) continue;
    const raw = bytes.subarray(f.value, f.end);
    const text = bytes[f.value] === 0x69 ? undefined : new TextDecoder().decode(raw.subarray(raw.indexOf(0x3a) + 1)).slice(0, 80);
    if (f.key === "created by") findings.push({ code: "software", value: text });
    else if (f.key === "creation date") {
      const seconds = Number(new TextDecoder().decode(raw.subarray(1, -1)));
      findings.push({ code: "datetime", value: new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19) });
    } else if (f.key.startsWith("comment")) findings.push({ code: "comment", value: text });
    else if (f.key.startsWith("publisher")) findings.push({ code: "owner", value: text });
    else findings.push(other(f.key, text));
  }
  if (parsed.end < bytes.length) findings.push({ code: "trailer" });
  return findings;
}

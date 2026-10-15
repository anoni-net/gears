import { ascii, startsWith, u32le } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { id3v1Findings, id3v2Findings } from "./id3.ts";
import { tagFinding } from "./media-tags.ts";
import { Tally } from "./package.ts";

// WAV 與 AVI 都是 RIFF：一串「代號(4) 長度(4，小端序) 內容」的 chunk，LIST 裡面還有 chunk。
//
// - LIST INFO：標題、演出者、註解、建立日期、軟體、工程師
// - bext（廣播用 WAV）：錄音的人、單位、時間、編碼紀錄
// - iXML、_PMX（XMP）、id3、cart：錄音設備與編輯軟體的資料
// - AVI 的 IDIT（拍攝時間）、strd（相機廠商的私有資料）、strn（串流名稱）
// - JUNK：本來是填充，有些相機在裡面寫了廠商與型號
//
// AVI 的索引有時記的是檔案裡的絕對位置，所以這裡原地處理：用白名單保留需要的 chunk，
// 其他的代號改成 JUNK、內容清成零，長度不變。JUNK 原本的內容也清成零。RIFF 長度之後
// 接的資料（常見的是標籤軟體附加的 ID3）拿掉。

const JUNK = [0x4a, 0x55, 0x4e, 0x4b];

interface Chunk {
  id: string;
  start: number;
  data: number;
  end: number; // 內容結束的位置，不含補齊的位元組
  form?: string; // RIFF 與 LIST 的類型
}

function chunks(bytes: Uint8Array, start: number, end: number): Chunk[] {
  const list: Chunk[] = [];
  let i = start;
  while (i + 8 <= end) {
    const id = ascii(bytes, i, 4);
    let size = u32le(bytes, i + 4);
    // RF64 的 data 長度記在 ds64，這裡寫 0xFFFFFFFF，視為到結尾
    if (size === 0xffffffff) size = end - i - 8;
    if (i + 8 + size > end) throw new ToolError("broken");
    const form = id === "LIST" || id === "RIFF" ? ascii(bytes, i + 8, 4) : undefined;
    list.push({ id, start: i, data: i + 8, end: i + 8 + size, form });
    i += 8 + size + (size & 1);
  }
  return list;
}

// 每一層保留的 chunk。LIST 用「LIST 類型」表示
const WAV_KEEP = new Set(["fmt ", "data", "fact", "cue ", "smpl", "inst", "plst", "ds64", "acid", "LIST adtl"]);
const AVI_KEEP: Record<string, Set<string>> = {
  "AVI ": new Set(["LIST hdrl", "LIST movi", "idx1"]),
  AVIX: new Set(["LIST movi"]),
  hdrl: new Set(["avih", "LIST strl", "LIST odml"]),
  strl: new Set(["strh", "strf", "indx", "vprp"]),
  odml: new Set(["dmlh"]),
};
const PADDING = new Set(["JUNK", "junk", "PAD ", "FLLR"]);

const label = (c: Chunk) => (c.form && c.id === "LIST" ? `LIST ${c.form}` : c.id);

function riffEnd(bytes: Uint8Array): number {
  const size = u32le(bytes, 4);
  return size === 0xffffffff ? bytes.length : Math.min(bytes.length, 8 + size);
}

function segmentOf(c: Chunk) {
  if (c.id === "_PMX") return "xmp" as const;
  if (c.id === "IDIT" || c.id === "strd" || c.id === "strn" || c.id === "LIST" || c.id === "bext" || c.id.toLowerCase() === "id3 ") return "media-tags" as const;
  return "other" as const;
}

function walk(bytes: Uint8Array, start: number, end: number, keep: (c: Chunk, level: string) => boolean | "descend", level: string, tally: Tally) {
  for (const c of chunks(bytes, start, end)) {
    if (PADDING.has(c.id)) {
      if (bytes.subarray(c.data, c.end).some((b) => b)) tally.add("other");
      bytes.fill(0, c.data, c.end);
      continue;
    }
    const decision = keep(c, level);
    if (decision === "descend") walk(bytes, c.data + 4, c.end, keep, c.form!, tally);
    else if (!decision) {
      tally.add(segmentOf(c));
      bytes.set(JUNK, c.start);
      bytes.fill(0, c.data, c.end);
    }
  }
}

// AVI 超過 1 GB 時後面接著 RIFF AVIX，回傳最後一個的結尾
function avixEnd(bytes: Uint8Array, end: number, visit?: (c: Chunk) => void): number {
  let at = end + (end & 1);
  while (at + 12 <= bytes.length && startsWith(bytes, at, "RIFF") && startsWith(bytes, at + 8, "AVIX")) {
    const next = at + 8 + u32le(bytes, at + 4);
    if (next > bytes.length) throw new ToolError("broken");
    visit?.({ id: "RIFF", start: at, data: at + 8, end: next, form: "AVIX" });
    at = next + (next & 1);
  }
  return Math.min(at, bytes.length);
}

export function stripRiff(input: Uint8Array): RunResult {
  const bytes = new Uint8Array(input);
  if (!startsWith(bytes, 0, "RIFF") && !startsWith(bytes, 0, "RF64")) throw new ToolError("broken");
  const form = ascii(bytes, 8, 4);
  let end = riffEnd(bytes);
  const tally = new Tally();
  if (form === "WAVE") {
    walk(bytes, 12, end, (c) => WAV_KEEP.has(label(c)), "WAVE", tally);
  } else if (form === "AVI ") {
    const keep = (c: Chunk, level: string) => {
      if (!AVI_KEEP[level]?.has(label(c))) return false;
      return c.id === "LIST" && c.form !== "movi" ? "descend" : true;
    };
    walk(bytes, 12, end, keep, "AVI ", tally);
    end = avixEnd(bytes, end, (c) => walk(bytes, c.data + 4, c.end, keep, "AVIX", tally));
  } else throw new ToolError("unsupported");
  // RIFF 之後附加的資料，常見的是標籤軟體加上的 ID3
  if (end < bytes.length) tally.add("trailer");
  return { data: bytes.slice(0, end), report: { removed: tally.items(), kept: [{ code: "media-stream" }] } };
}

function infoFindings(bytes: Uint8Array, list: Chunk): Finding[] {
  return chunks(bytes, list.data + 4, list.end).map((c) =>
    tagFinding(c.id, new TextDecoder().decode(bytes.subarray(c.data, c.end))),
  );
}

const text = (bytes: Uint8Array, at: number, length: number) =>
  new TextDecoder("latin1").decode(bytes.subarray(at, at + length)).replace(/\0.*$/s, "").trim() || undefined;

function inspectChunks(bytes: Uint8Array, start: number, end: number, findings: Finding[], depth: number) {
  for (const c of chunks(bytes, start, end)) {
    if (c.id === "LIST" && c.form === "INFO") findings.push(...infoFindings(bytes, c));
    else if (c.id === "LIST" && c.form !== "movi" && depth < 3) inspectChunks(bytes, c.data + 4, c.end, findings, depth + 1);
    else if (c.id === "bext") {
      // Description（256）、Originator（32）、OriginatorReference（32）、OriginationDate（10）、OriginationTime（8）
      const owner = text(bytes, c.data + 256, 32);
      const date = text(bytes, c.data + 320, 10);
      const comment = text(bytes, c.data, 256);
      if (owner) findings.push({ code: "owner", value: owner });
      if (date) findings.push({ code: "datetime", value: `${date} ${text(bytes, c.data + 330, 8) ?? ""}`.trim() });
      if (comment) findings.push({ code: "comment", value: comment.slice(0, 80) });
    } else if (c.id === "_PMX") findings.push({ code: "xmp" });
    else if (c.id.toLowerCase() === "id3 ") findings.push(...id3v2Findings(bytes, c.data));
    else if (c.id === "IDIT") findings.push({ code: "datetime", value: text(bytes, c.data, c.end - c.data) });
    else if (c.id === "iXML" || c.id === "strd" || c.id === "cart" || c.id === "axml") findings.push({ code: "other" });
    else if (PADDING.has(c.id) && /[A-Za-z]{6}/.test(new TextDecoder("latin1").decode(bytes.subarray(c.data, Math.min(c.end, c.data + 4096)))))
      findings.push({ code: "other" });
  }
}

export function inspectRiff(bytes: Uint8Array): Finding[] {
  const findings: Finding[] = [];
  try {
    let end = riffEnd(bytes);
    inspectChunks(bytes, 12, end, findings, 0);
    if (ascii(bytes, 8, 4) === "AVI ") end = avixEnd(bytes, end);
    if (end + 128 <= bytes.length && startsWith(bytes, bytes.length - 128, "TAG")) findings.push(...id3v1Findings(bytes, bytes.length - 128));
    else if (end < bytes.length) findings.push({ code: "trailer" });
  } catch {
    return findings;
  }
  return findings;
}

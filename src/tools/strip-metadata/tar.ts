import { ascii, concat } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { SYSTEM_FILE } from "./archive.ts";
import { type Inner, Tally } from "./package.ts";

// TAR：每個檔案前面一個 512 位元組的標頭，記錄檔名、權限、擁有者的 ID 與帳號名稱、修改時間。
// POSIX 的延伸標頭（pax）還有存取時間、變更時間與延伸屬性，macOS 的延伸屬性常帶著下載
// 來源的網址。
//
// 擁有者改成 0 與空白、時間清成零，延伸標頭只留檔名、連結目標、大小與稀疏檔的資訊，
// 檔案權限保留（執行檔才能執行）。macOS 的 ._ 檔與 .DS_Store 拿掉，裡面的照片與文件交給
// 對應格式的處理程式。

const BLOCK = 512;
const KEEP_PAX = /^(path|linkpath|size|GNU\.sparse\.)/;
const MAX_TOTAL = 512 * 1024 * 1024;

function octal(bytes: Uint8Array, at: number, length: number): number {
  // 太大的數字用 base-256：第一個位元組的最高位元是 1
  if (bytes[at]! & 0x80) {
    let n = bytes[at]! & 0x7f;
    for (let i = 1; i < length; i++) n = n * 256 + bytes[at + i]!;
    return n;
  }
  const text = ascii(bytes, at, length).replace(/[\0 ].*$/s, "").trim();
  return text ? parseInt(text, 8) : 0;
}

function writeOctal(header: Uint8Array, at: number, length: number, value: number) {
  const text = value.toString(8).padStart(length - 1, "0");
  for (let i = 0; i < length - 1; i++) header[at + i] = text.charCodeAt(i);
  header[at + length - 1] = 0;
}

function checksum(header: Uint8Array) {
  header.fill(0x20, 148, 156);
  const sum = header.reduce((n, b) => n + b, 0);
  const text = sum.toString(8).padStart(6, "0");
  for (let i = 0; i < 6; i++) header[148 + i] = text.charCodeAt(i);
  header[154] = 0;
  header[155] = 0x20;
}

const isZero = (block: Uint8Array) => block.every((b) => b === 0);

interface Entry {
  header: Uint8Array;
  data: Uint8Array;
  type: string;
  name: string;
}

function entries(bytes: Uint8Array): Entry[] {
  const list: Entry[] = [];
  let at = 0;
  while (at + BLOCK <= bytes.length) {
    const header = bytes.subarray(at, at + BLOCK);
    if (isZero(header)) break;
    const stored = octal(header, 148, 8);
    const sum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 0x20 : b), 0);
    if (stored !== sum) throw new ToolError("broken");
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156]! || 0x30);
    const prefix = ascii(header, 257, 6) === "ustar\0" ? ascii(header, 345, 155).replace(/\0.*$/s, "") : "";
    const name = (prefix ? `${prefix}/` : "") + ascii(header, 0, 100).replace(/\0.*$/s, "");
    const end = at + BLOCK + size;
    if (end > bytes.length) throw new ToolError("broken");
    list.push({ header, data: bytes.subarray(at + BLOCK, end), type, name });
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return list;
}

// pax 的每一筆是「長度 key=value\n」
function paxRecords(data: Uint8Array): [string, string][] {
  const text = new TextDecoder().decode(data);
  const records: [string, string][] = [];
  let at = 0;
  while (at < text.length) {
    const space = text.indexOf(" ", at);
    const length = parseInt(text.slice(at, space), 10);
    if (!(length > 0)) break;
    const record = text.slice(space + 1, at + length - 1);
    const eq = record.indexOf("=");
    records.push([record.slice(0, eq), record.slice(eq + 1)]);
    at += length;
  }
  return records;
}

function encodePax(records: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  return concat(
    records.map(([key, value]) => {
      const body = ` ${key}=${value}\n`;
      let length = enc.encode(body).length;
      length += String(length + String(length).length).length;
      return enc.encode(`${length}${body}`);
    }),
  );
}

function pad(data: Uint8Array): Uint8Array {
  const rest = data.length % BLOCK;
  return rest ? concat([data, new Uint8Array(BLOCK - rest)]) : data;
}

// 擁有者、時間與裝置號碼清掉，權限保留
function normalize(source: Uint8Array, size: number): Uint8Array {
  const header = source.slice();
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0, 265, 329);
  const type = header[156];
  if (type !== 0x33 && type !== 0x34) header.fill(0, 329, 345);
  // GNU 格式在 prefix 的位置放存取與變更時間
  if (ascii(header, 257, 8) === "ustar  \0") header.fill(0, 345, 369);
  checksum(header);
  return header;
}

const changed = (header: Uint8Array) =>
  octal(header, 108, 8) !== 0 || octal(header, 116, 8) !== 0 || octal(header, 136, 12) !== 0 || header.subarray(265, 329).some((b) => b);

export async function stripTar(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const list = entries(bytes);
  if (list.reduce((n, e) => n + e.data.length, 0) > MAX_TOTAL) throw new ToolError("unsupported");
  const tally = new Tally();
  const out: Uint8Array[] = [];
  let pending: Uint8Array[] = []; // 延伸標頭套用在下一個檔案，那個檔案拿掉的話一起拿掉
  let cleaned = 0;
  for (const entry of list) {
    if (entry.type === "x" || entry.type === "g") {
      const records = paxRecords(entry.data);
      const kept = records.filter(([key]) => KEEP_PAX.test(key));
      if (kept.length < records.length) tally.add("archive-info");
      if (!kept.length) continue;
      const data = encodePax(kept);
      const block = [normalize(entry.header, data.length), pad(data)];
      if (entry.type === "g") out.push(...block);
      else pending.push(...block);
      continue;
    }
    if (entry.type === "L" || entry.type === "K") {
      pending.push(normalize(entry.header, entry.data.length), pad(entry.data));
      continue;
    }
    if (SYSTEM_FILE.test(entry.name)) {
      tally.add("archive-system");
      pending = [];
      continue;
    }
    if (changed(entry.header)) tally.add("archive-info");
    let data = entry.data;
    if (entry.type === "0") {
      const result = await inner.strip(data);
      if (result?.report.removed.length) {
        data = result.data;
        cleaned++;
      }
    }
    out.push(...pending, normalize(entry.header, data.length), pad(data));
    pending = [];
  }
  if (cleaned) tally.add("archive-files");
  out.push(new Uint8Array(BLOCK * 2));
  return { data: concat(out), report: { removed: tally.items(), kept: [{ code: "archive-content" }] } };
}

export async function inspectTar(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const list = entries(bytes);
  if (list.reduce((n, e) => n + e.data.length, 0) > MAX_TOTAL) return [];
  const findings: Finding[] = [];
  const owners = new Set<string>();
  let latest = 0;
  const system: string[] = [];
  for (const entry of list) {
    if (entry.type === "x" || entry.type === "g") {
      const extra = paxRecords(entry.data).filter(([key]) => !KEEP_PAX.test(key));
      if (extra.length) findings.push({ code: "other", value: extra.map(([key]) => key).slice(0, 3).join("、") });
      continue;
    }
    if (SYSTEM_FILE.test(entry.name)) {
      system.push(entry.name.split("/").at(-1)!);
      continue;
    }
    const user = ascii(entry.header, 265, 32).replace(/\0.*$/s, "");
    const group = ascii(entry.header, 297, 32).replace(/\0.*$/s, "");
    if (user) owners.add(user);
    if (group && group !== user) owners.add(group);
    latest = Math.max(latest, octal(entry.header, 136, 12));
    if (entry.type === "0") findings.push(...((await inner.inspect(entry.data)) ?? []));
  }
  if (owners.size) findings.unshift({ code: "owner", value: [...owners].slice(0, 5).join("、") });
  if (latest) findings.push({ code: "datetime", value: new Date(latest * 1000).toISOString().replace("T", " ").slice(0, 19) });
  if (system.length) findings.push({ code: "system-files", value: [...new Set(system)].slice(0, 5).join("、") });
  return findings;
}

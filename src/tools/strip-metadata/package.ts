import { type Finding, type ReportItem, type RunResult, type SegmentCode, ToolError } from "../../core/tool.ts";
import { decodeUtf8, tokenizeXml } from "../../core/xml.ts";
import { entryData, readZip, writeZip } from "../../core/zip.ts";

// Office（OOXML）與 ODF 共用的部分：兩者都是 zip 包著一組 XML 與圖片。

export interface Part {
  name: string;
  data: Uint8Array;
  compress: boolean;
}

// 解壓縮之後的總大小上限。正常的文件遠低於這個數字，超過的多半是刻意做成的壓縮炸彈
const MAX_TOTAL = 512 * 1024 * 1024;

export async function readParts(bytes: Uint8Array): Promise<Part[]> {
  const { entries } = readZip(bytes);
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_TOTAL) throw new ToolError("unsupported");
  const parts: Part[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue; // 目錄
    parts.push({ name: entry.name, data: await entryData(bytes, entry), compress: entry.method === 8 });
  }
  return parts;
}

// 寫出之後重新解開一次，每個 XML 都要讀得過，改壞的檔案不交出去
export async function writeParts(parts: Part[]): Promise<Uint8Array> {
  const data = await writeZip(parts);
  for (const part of await readParts(data)) {
    if (/\.(xml|rels)$/i.test(part.name)) tokenizeXml(partText(part));
  }
  return data;
}

export const partText = (part: Part) => decodeUtf8(part.data);

export function setText(part: Part, text: string) {
  part.data = new TextEncoder().encode(text);
}

// 圖片與內嵌的文件交給對應格式的處理程式。由 index.ts 提供，避免互相引用；
// 不支援的格式回傳 null
export interface Inner {
  inspect(data: Uint8Array): Promise<Finding[] | null>;
  strip(data: Uint8Array): Promise<RunResult | null>;
}

// 註解與修訂的作者一律改成這個名字，時間改成固定的值。用英文是因為它寫在檔案裡，
// 開啟的軟體與讀者的語系無關
export const NEUTRAL_AUTHOR = "Author";
export const NEUTRAL_TIME = "1980-01-01T00:00:00Z";

// 舊版的 Excel 新增註解時，會把作者的名字寫在內文開頭（「名字:」），轉成 ODF 也會帶過去
export function authorPrefix(text: string, authors: Set<string>, changed: () => void): string | undefined {
  for (const author of authors) {
    if (author === NEUTRAL_AUTHOR || !text.startsWith(`${author}:`)) continue;
    changed();
    return NEUTRAL_AUTHOR + text.slice(author.length);
  }
  return undefined;
}

// 電腦上的路徑只留檔名。網址（http、https、mailto 等）不動
export function isLocalPath(target: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith("\\\\") || /^file:/i.test(target)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return false;
  return /[\\/]/.test(target);
}

export function basename(target: string): string {
  let path = target;
  try {
    path = decodeURI(target);
  } catch {
    // 不是合法的百分比編碼，照原樣處理
  }
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

// 處理報告。同一種項目只列一次，順序照第一次出現的位置
export class Tally {
  private codes = new Map<SegmentCode, ReportItem>();

  add(code: SegmentCode, count?: number) {
    const item = this.codes.get(code);
    if (!item) this.codes.set(code, count === undefined ? { code } : { code, count });
    else if (count !== undefined) item.count = (item.count ?? 0) + count;
  }

  merge(items: ReportItem[]) {
    for (const item of items) this.add(item.code);
  }

  items(): ReportItem[] {
    return [...this.codes.values()];
  }
}

// 圖片與內嵌的文件逐一交給對應的處理程式。回傳處理過幾個
export async function stripInner(parts: Part[], inner: Inner, skip: (part: Part) => boolean): Promise<number> {
  let changed = 0;
  for (const part of parts) {
    if (skip(part)) continue;
    const result = await inner.strip(part.data);
    if (!result) continue;
    if (result.report.removed.length) changed++;
    part.data = result.data;
  }
  return changed;
}

export async function inspectInner(parts: Part[], inner: Inner, skip: (part: Part) => boolean): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const part of parts) {
    if (skip(part)) continue;
    findings.push(...((await inner.inspect(part.data)) ?? []));
  }
  return findings;
}

import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { dosDate, entryData, readZip, writeZip, type NewEntry } from "../../core/zip.ts";
import { type Inner, Tally } from "./package.ts";

// ZIP 壓縮檔。每個檔案帶著修改時間、建立的系統，附加欄位裡常有精確到秒的時間與 Unix 的
// 使用者 ID，壓縮檔與個別檔案還可以有註解。重新打包時這些全部統一或拿掉（見 src/core/zip.ts）。
//
// macOS 壓縮時會加上 __MACOSX/ 與 ._ 開頭的檔案，裡面是延伸屬性，常見的有下載來源的網址
// （kMDItemWhereFroms）與隔離標記。.DS_Store 記著資料夾裡的檔名，Windows 的 Thumbs.db
// 存著圖片的縮圖，包括已經刪掉的。這些系統檔整個拿掉。
//
// 壓縮檔裡的照片、文件與影音交給對應格式的處理程式，一起清除。

// 解壓縮之後的總大小上限，跟文件一樣
const MAX_TOTAL = 512 * 1024 * 1024;

export const SYSTEM_FILE = /(^|\/)(__MACOSX\/|\._[^/]*$|\.DS_Store$|Thumbs\.db$|ehthumbs\.db$|desktop\.ini$)/i;

export async function stripZipArchive(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const { entries, commentLength } = readZip(bytes);
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_TOTAL) throw new ToolError("unsupported");
  const tally = new Tally();
  if (commentLength || entries.some((e) => e.extraLength || e.commentLength || e.madeBy !== 0 || dosDate(e))) tally.add("archive-info");
  const parts: NewEntry[] = [];
  let cleaned = 0;
  for (const entry of entries) {
    if (SYSTEM_FILE.test(entry.name)) {
      tally.add("archive-system");
      continue;
    }
    if (entry.name.endsWith("/")) {
      parts.push({ name: entry.name, data: new Uint8Array(), compress: false });
      continue;
    }
    let data = await entryData(bytes, entry);
    const result = await inner.strip(data);
    if (result?.report.removed.length) {
      data = result.data;
      cleaned++;
    }
    parts.push({ name: entry.name, data, compress: entry.method === 8 });
  }
  if (cleaned) tally.add("archive-files");
  const data = await writeZip(parts);
  readZip(data);
  return { data, report: { removed: tally.items(), kept: [{ code: "archive-content" }] } };
}

export async function inspectZipArchive(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const { entries, commentLength } = readZip(bytes);
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_TOTAL) return [];
  const findings: Finding[] = [];
  const dates = entries.map(dosDate).filter((d): d is string => !!d).sort();
  if (dates.length) findings.push({ code: "datetime", value: dates.at(-1) });
  if (entries.some((e) => e.extraLength || e.madeBy !== 0)) findings.push({ code: "other" });
  if (commentLength || entries.some((e) => e.commentLength)) findings.push({ code: "comment" });
  const system = [...new Set(entries.filter((e) => SYSTEM_FILE.test(e.name)).map((e) => (e.name.startsWith("__MACOSX/") ? "__MACOSX" : e.name.split("/").at(-1)!)))];
  if (system.length) findings.push({ code: "system-files", value: system.slice(0, 5).join("、") });
  for (const entry of entries) {
    if (entry.name.endsWith("/") || SYSTEM_FILE.test(entry.name)) continue;
    findings.push(...((await inner.inspect(await entryData(bytes, entry))) ?? []));
  }
  return findings;
}

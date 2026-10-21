import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { dosDate, entryData, readZip, writeZip, type NewEntry } from "../../core/zip.ts";
import { parseProofCsv, parseProofJson, proofHashes } from "../verify/proofmode.ts";
import { type Inner, Tally } from "./package.ts";
import { other } from "./preview.ts";

// ZIP 壓縮檔。每個檔案帶著修改時間、建立的系統，附加欄位裡常有精確到秒的時間與 Unix 的
// 使用者 ID，壓縮檔與個別檔案還可以有註解。重新打包時這些全部統一或拿掉（見 src/core/zip.ts）。
//
// macOS 壓縮時會加上 __MACOSX/ 與 ._ 開頭的檔案，裡面是延伸屬性，常見的有下載來源的網址
// （kMDItemWhereFroms）與隔離標記。.DS_Store 記著資料夾裡的檔名，Windows 的 Thumbs.db
// 存著圖片的縮圖，包括已經刪掉的。這些系統檔整個拿掉。
//
// 壓縮檔裡的照片、文件與影音交給對應格式的處理程式，一起清除。

// ProofMode 的證明檔（src/tools/verify/proofmode.ts）：照片簽過名，清除會讓簽章對不上，證明就失去
// 作用。照片與證明檔保留原樣，只統一壓縮檔本身的時間與附加欄位。感測器資料裡的位置與網路
// 在檢查結果裡列出，交不交出去由讀者決定
const SENSITIVE = ["Location.Latitude", "Location.Longitude", "Wifi MAC", "IPv4", "IPv6", "CellInfo", "DeviceID", "Network"];

// 解壓縮之後的總大小上限，跟文件一樣
const MAX_TOTAL = 512 * 1024 * 1024;

const SYSTEMS: Record<number, string> = { 0: "MS-DOS", 3: "Unix", 10: "NTFS", 19: "macOS" };

export const SYSTEM_FILE = /(^|\/)(__MACOSX\/|\._[^/]*$|\.DS_Store$|Thumbs\.db$|ehthumbs\.db$|desktop\.ini$)/i;

export async function stripZipArchive(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const { entries, commentLength } = readZip(bytes);
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_TOTAL) throw new ToolError("unsupported");
  const tally = new Tally();
  if (commentLength || entries.some((e) => e.extraLength || e.commentLength || e.madeBy !== 0 || dosDate(e))) tally.add("archive-info");
  const parts: NewEntry[] = [];
  let cleaned = 0;
  const proofs = proofHashes(entries.map((e) => e.name));
  let kept = false;
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
    if (proofs.length && proofs.includes(bytesToHex(sha256(data)))) {
      parts.push({ name: entry.name, data, compress: entry.method === 8 });
      kept = true;
      continue;
    }
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
  return { data, report: { removed: tally.items(), kept: [{ code: "archive-content" }, ...(kept ? [{ code: "archive-proofmode" as const }] : [])] } };
}

export async function inspectZipArchive(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const { entries, commentLength } = readZip(bytes);
  if (entries.reduce((n, e) => n + e.size, 0) > MAX_TOTAL) return [];
  const findings: Finding[] = [];
  const dates = entries.map(dosDate).filter((d): d is string => !!d).sort();
  if (dates.length) findings.push({ code: "datetime", value: dates.at(-1) });
  // 建立的系統與附加欄位：Unix 的附加欄位帶著使用者 ID 與精確的時間
  const systems = [...new Set(entries.filter((e) => e.extraLength || e.madeBy !== 0).map((e) => SYSTEMS[e.madeBy] ?? `system ${e.madeBy}`))];
  if (systems.length) findings.push(other("extra field", systems.join(" ")));
  if (commentLength || entries.some((e) => e.commentLength)) findings.push({ code: "comment" });
  const system = [...new Set(entries.filter((e) => SYSTEM_FILE.test(e.name)).map((e) => (e.name.startsWith("__MACOSX/") ? "__MACOSX" : e.name.split("/").at(-1)!)))];
  if (system.length) findings.push({ code: "system-files", value: system.slice(0, 5).join("、") });
  const proofs = proofHashes(entries.map((e) => e.name));
  if (proofs.length) {
    const fields = new Set<string>();
    for (const entry of entries) {
      const name = entry.name.split("/").at(-1)!;
      const parse = name.endsWith(".proof.json") ? parseProofJson : name.endsWith(".proof.csv") ? parseProofCsv : undefined;
      if (!parse) continue;
      for (const [k] of parse(new TextDecoder().decode(await entryData(bytes, entry)))) if (SENSITIVE.includes(k)) fields.add(k);
    }
    findings.push({ code: "proofmode", value: SENSITIVE.filter((k) => fields.has(k)).join(", ") || undefined });
  }
  for (const entry of entries) {
    if (entry.name.endsWith("/") || SYSTEM_FILE.test(entry.name)) continue;
    findings.push(...((await inner.inspect(await entryData(bytes, entry))) ?? []));
  }
  return findings;
}

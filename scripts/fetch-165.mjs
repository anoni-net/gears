// 下載 165 反詐騙諮詢專線的「遭停止解析涉詐網站」清單，整理成 public/data/165.txt。
//
// 來源是政府資料開放平台的資料集 176455（內政部警政署，政府資料開放授權條款第 1 版），
// 每月更新。部署時執行一次，檔案不進版控。
//
//   node scripts/fetch-165.mjs [輸出路徑]

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SOURCE =
  "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/9586E691-5D8C-4A1C-867B-32473EFCAA7B/download";
const OUT = process.argv[2] ?? "public/data/165.txt";

// 資料平台偶爾在下載到一半時中斷連線（2026-10-21 連續兩次 other side closed），間隔 5、10 秒再試兩次
async function download() {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(SOURCE);
      if (!res.ok) throw new Error(`下載失敗：HTTP ${res.status}`);
      return (await res.text()).replace(/^\uFEFF/, "");
    } catch (error) {
      if (attempt >= 3) throw error;
      console.warn(`第 ${attempt} 次下載失敗（${error.message}），${attempt * 5} 秒後再試`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
  }
}

const csv = await download();
const [header, ...rows] = csv.split(/\r?\n/);
const columns = header.split(",");
const monthCol = columns.indexOf("民國年月");
const domainCol = columns.indexOf("網域");
if (monthCol < 0 || domainCol < 0) throw new Error(`欄位不符：${header}`);

const domains = new Set();
const months = new Set();
let skipped = 0;
for (const row of rows) {
  if (!row.trim()) continue;
  const cells = row.split(",");
  // 有些列帶著路徑或前置符號（example.top/h5、?example.top），只取主機名
  const host = (cells[domainCol] ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split("/")[0]
    .replace(/^[^a-z0-9]+/, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
    skipped++;
    continue;
  }
  domains.add(host);
  const roc = cells[monthCol]?.trim();
  if (/^\d{5}$/.test(roc)) months.add(`${Number(roc.slice(0, 3)) + 1911}-${roc.slice(3)}`);
}
if (domains.size < 1000) throw new Error(`網域只有 ${domains.size} 個，資料可能有問題`);

const sorted = [...months].sort();
const meta = `# from=${sorted[0]} to=${sorted.at(-1)} count=${domains.size} fetched=${new Date().toISOString().slice(0, 10)}`;
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${meta}\n${[...domains].sort().join("\n")}\n`);
console.log(`${OUT}: ${domains.size} 個網域（${sorted[0]} 到 ${sorted.at(-1)}），略過 ${skipped} 列`);

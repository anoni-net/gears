// 推到 build 分支之前，確認網站參照到的檔案都在。
//
//   node scripts/check-site.mjs <網站目錄> [網站的路徑，預設 /gears/] [--onion]
//
// 檢查三種參照：sw.js 預先存的檔案清單、頁面載入的 <路徑>assets/、程式之間互相
// 匯入的 ./檔名 與 "assets/檔名"。少了任何一個就列出來，結束碼 1。
//
// 加上 --onion 時另外檢查 onion 版沒有連到 clearnet 的 anoni.net：頁面、程式、樣式與 manifest
// 裡不能出現 https://anoni.net、aa.anoni.net（使用統計）、assets.anoni.net（社群的檔案伺服器）。
// 授權說明的文字檔（.txt）會寫到檔案的出處，不算。
//
// 2026-10-17 的部署是這樣壞掉的：頁面與 sw.js 只換了雜湊、大小不變，rsync 判斷沒變
// 而沒有複製，新的程式跟舊的頁面參照到不同的檔案，sw.js 清單裡的檔案也已經刪掉。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ASSET = /[\w.-]+\.(?:js|mjs|css|wasm|txt)/.source;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function missingFiles(site, base = "/gears/") {
  const missing = new Set();
  const need = (path, from) => {
    if (!existsSync(join(site, path))) missing.add(`${path}（${from}）`);
  };

  let pageRefs = 0;
  const sw = join(site, "sw.js");
  if (existsSync(sw)) {
    const m = readFileSync(sw, "utf8").match(/const FILES = (\[[^\]]*\])/);
    if (!m) missing.add("sw.js 裡找不到 FILES");
    else for (const f of JSON.parse(m[1])) need(f, "sw.js");
  }

  for (const file of walk(site)) {
    const from = relative(site, file);
    if (file.endsWith(".html")) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(new RegExp(`${escapeRe(base)}(assets/${ASSET})`, "g"))) {
        pageRefs++;
        need(m[1], from);
      }
    } else if (/\/assets\/[^/]+\.m?js$/.test(file)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(new RegExp(`(?:from|import\\()\\s*"\\./(${ASSET})"`, "g"))) need(`assets/${m[1]}`, from);
      for (const m of text.matchAll(new RegExp(`"(assets/${ASSET})"`, "g"))) need(m[1], from);
    }
  }
  // 路徑給錯時一個參照都比對不到，看起來像是全部都在
  if (!pageRefs) missing.add(`頁面沒有載入任何 ${base}assets/ 的檔案，網站的路徑是否正確`);
  return [...missing].sort();
}

const CLEARNET = /https:\/\/(?:(?:aa|assets)\.)?anoni\.net\b/;

export function clearnetRefs(site) {
  const found = [];
  for (const file of walk(site)) {
    if (!/\.(?:html|m?js|css|webmanifest|xml|json)$/.test(file)) continue;
    const m = readFileSync(file, "utf8").match(CLEARNET);
    if (m) found.push(`${relative(site, file)}：${m[0]}`);
  }
  return found.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const onion = args.includes("--onion");
  const [site, base = "/gears/"] = args.filter((a) => a !== "--onion");
  if (!site) {
    console.error("用法：node scripts/check-site.mjs <網站目錄> [網站的路徑] [--onion]");
    process.exit(2);
  }
  let failed = false;
  const missing = missingFiles(site, base);
  if (missing.length) {
    console.error(`網站參照到 ${missing.length} 個不存在的檔案：`);
    for (const m of missing) console.error(`  ${m}`);
    failed = true;
  } else console.log("網站參照到的檔案都在");
  if (onion) {
    const refs = clearnetRefs(site);
    if (refs.length) {
      console.error(`onion 版有 ${refs.length} 個檔案連到 clearnet：`);
      for (const r of refs) console.error(`  ${r}`);
      failed = true;
    } else console.log("onion 版沒有連到 clearnet");
  }
  if (failed) process.exit(1);
}

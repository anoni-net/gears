// 推到 build 分支之前，確認網站參照到的檔案都在。
//
//   node scripts/check-site.mjs <網站目錄>
//
// 檢查三種參照：sw.js 預先存的檔案清單、頁面載入的 /gears/assets/、程式之間互相
// 匯入的 ./檔名 與 "assets/檔名"。少了任何一個就列出來，結束碼 1。
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

export function missingFiles(site) {
  const missing = new Set();
  const need = (path, from) => {
    if (!existsSync(join(site, path))) missing.add(`${path}（${from}）`);
  };

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
      for (const m of text.matchAll(new RegExp(`/gears/(assets/${ASSET})`, "g"))) need(m[1], from);
    } else if (/\/assets\/[^/]+\.m?js$/.test(file)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(new RegExp(`(?:from|import\\()\\s*"\\./(${ASSET})"`, "g"))) need(`assets/${m[1]}`, from);
      for (const m of text.matchAll(new RegExp(`"(assets/${ASSET})"`, "g"))) need(m[1], from);
    }
  }
  return [...missing].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const site = process.argv[2];
  if (!site) {
    console.error("用法：node scripts/check-site.mjs <網站目錄>");
    process.exit(2);
  }
  const missing = missingFiles(site);
  if (missing.length) {
    console.error(`網站參照到 ${missing.length} 個不存在的檔案：`);
    for (const m of missing) console.error(`  ${m}`);
    process.exit(1);
  }
  console.log("網站參照到的檔案都在");
}

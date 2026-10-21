// 查證驗證 C2PA 內容憑證用的信任清單（src/tools/verify/c2pa-trust/）由這支腳本產生。
// 每月跟著下載的軟體驗證的公鑰一起核對一次：從官方的 repo 下載最新版，寫回檔案，並記下
// 來源的 commit。清單只會在建置時內嵌，查證的時候不連線。
//
//   node scripts/c2pa-trust.mjs           下載、寫回
//   node scripts/c2pa-trust.mjs --check   只比對，跟目前的檔案不同時以非零值結束
//
// 只用 C2PA 的正式清單：c2pa-org/conformance-public 的 trust-list/（CC-BY-4.0），C2PA 一致性計畫的簽署者
// 與時間戳記服務。2026-01-01 起凍結的過渡清單（Interim Trust List）不用

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SOURCES = [
  {
    repo: "c2pa-org/conformance-public",
    files: { "official.pem": "trust-list/C2PA-TRUST-LIST.pem", "official-tsa.pem": "trust-list/C2PA-TSA-TRUST-LIST.pem" },
  },
];

const OUT = new URL("../src/tools/verify/c2pa-trust/", import.meta.url);
const check = process.argv.includes("--check");

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "anoni-net-gears" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

const sources = {};
const files = {};
for (const source of SOURCES) {
  const { sha, commit } = await (await get(`https://api.github.com/repos/${source.repo}/commits/main`)).json();
  sources[source.repo] = { commit: sha, date: commit.committer.date };
  for (const [name, path] of Object.entries(source.files)) {
    const text = await (await get(`https://raw.githubusercontent.com/${source.repo}/${sha}/${path}`)).text();
    if (name.endsWith(".pem") && !text.includes("-----BEGIN CERTIFICATE-----")) throw new Error(`${name} 不是憑證`);
    files[name] = text;
    const count = (text.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
    console.log(`${name}：${source.repo}@${sha.slice(0, 10)}，${count || "-"} 張憑證，SHA-256 ${createHash("sha256").update(text).digest("hex").slice(0, 16)}`);
  }
}

let changed = false;
for (const [name, text] of Object.entries(files)) {
  let old = "";
  try {
    old = readFileSync(new URL(name, OUT), "utf8");
  } catch {
    // 第一次產生
  }
  if (old !== text) {
    changed = true;
    console.log(`${name} 有更新`);
  }
}

if (check) {
  if (changed) {
    console.error("信任清單有更新，執行 node scripts/c2pa-trust.mjs 寫回，開 PR");
    process.exit(1);
  }
  console.log("信任清單沒有變動");
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(new URL(name, OUT), text);
  writeFileSync(new URL("sources.json", OUT), `${JSON.stringify(sources, null, 2)}\n`);
  console.log(changed ? "已寫回" : "沒有變動");
}

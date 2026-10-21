// 查證驗證 PDF 數位簽章用的信任清單（src/tools/verify/pdf-trust/）由這支腳本產生，第一版只有台灣
// 政府憑證總管理中心（GRCA）的三代根憑證，以及它簽發的下屬憑證機構：內政部憑證管理中心（MOICA，
// 自然人憑證）、工商憑證管理中心（MOEACA）、政府憑證管理中心（GCA）、組織及團體憑證管理中心（XCA）。
// 每月跟 C2PA 的信任清單一起核對一次。查證的時候不連線
//
//   node scripts/pdf-trust.mjs           下載、比對指紋、寫回
//   node scripts/pdf-trust.mjs --check   只比對，跟目前的檔案不同時以非零值結束
//
// 根憑證的指紋寫死在這裡，對不上就停下來。2026-10-21 比對過：GRCA1、GRCA2 跟 CCADB 上 Microsoft 的
// 根憑證清單相同（兩者在 Microsoft 的狀態是 Disabled，macOS 與 Mozilla 也沒有收錄），GRCA3 不在那份
// 清單裡，比對的是數位發展部說明文件（xca.nat.gov.tw/data/training_11109.pdf）列的 SHA-1 末碼。
// 下屬憑證機構的憑證不鎖指紋，查證時照樣要驗過它是由根憑證簽的

import { X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ROOTS = {
  GRCA: "7600295EEFE85B9E1FD624DB76062AAAAE59818A54D2774CD4C0B2C01131E1B3",
  GRCA2: "70B922BFDA0E3F4A342E4EE22D579AE598D071CC5EC9C30F123680340388AEA5",
  GRCA3: "57DF6F20E04C588E85F35BE8832F5D4E78958336AE3B18FB7C9BAE0DFEAD4044",
};
const CAS = ["MOICA", "MOICA2", "MOICA3", "MOEACA", "MOEACA2", "MOEACA3", "GCA", "GCA2", "GCA3", "XCA", "XCA2", "XCA3"];

const OUT = new URL("../src/tools/verify/pdf-trust/", import.meta.url);
const check = process.argv.includes("--check");

async function cert(url) {
  const res = await fetch(url, { headers: { "User-Agent": "anoni-net-gears" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  // 有的是 DER，有的是 PEM
  return new X509Certificate(data.includes("-----BEGIN CERTIFICATE-----") ? data.toString("latin1") : data);
}

const fp = (c) => c.fingerprint256.replaceAll(":", "");
const pem = (label, c) => `# ${label}：${c.subject.replaceAll("\n", ", ")}，效期到 ${new Date(c.validTo).toISOString().slice(0, 10)}\n${c.toString().trim()}\n`;

const roots = [];
for (const [name, expected] of Object.entries(ROOTS)) {
  const c = await cert(`https://grca.nat.gov.tw/repository/Certs/${name}.cer`);
  if (fp(c) !== expected) throw new Error(`${name} 的指紋是 ${fp(c)}，不是 ${expected}`);
  console.log(`${name} ${expected.slice(0, 16)}… 效期到 ${new Date(c.validTo).toISOString().slice(0, 10)}`);
  roots.push({ name, c });
}

const cas = [];
for (const name of CAS) {
  const c = await cert(`https://grca.nat.gov.tw/download/${name}.cer`);
  const issuer = roots.find((r) => c.checkIssued(r.c) && c.verify(r.c.publicKey));
  if (!issuer) throw new Error(`${name} 不是由 GRCA 的根憑證簽的`);
  const expired = new Date(c.validTo) < new Date();
  console.log(`${name} 由 ${issuer.name} 簽發，效期到 ${new Date(c.validTo).toISOString().slice(0, 10)}${expired ? "（已過期，留著驗證過期之前簽的文件）" : ""}`);
  cas.push({ name, c });
}

const files = {
  "grca-roots.pem": roots.map((r) => pem(r.name, r.c)).join("\n"),
  "gpki-cas.pem": cas.map((r) => pem(r.name, r.c)).join("\n"),
};

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
    console.error("信任清單有更新，執行 node scripts/pdf-trust.mjs 寫回，開 PR");
    process.exit(1);
  }
  console.log("信任清單沒有變動");
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(new URL(name, OUT), text);
  console.log(changed ? "已寫回" : "沒有變動");
}

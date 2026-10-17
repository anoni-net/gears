// 下載的軟體驗證內建的簽章公鑰（src/tools/software-verify/keys.ts）由這支腳本產生。
// 每月跟著文件站的查證核對一次：從官方的來源下載公鑰，確認主金鑰的指紋跟官方頁面公告的相同，
// 拿掉其他人的認證簽章（Tails 的公鑰有上千個，檔案 1.3 MB），寫回 keys.ts，並列出每把子金鑰的效期。
//
//   node scripts/signing-keys.mjs           下載、比對、寫回
//   node scripts/signing-keys.mjs --check   只比對，跟 keys.ts 不同時以非零值結束
//
// 指紋改了不會自動寫回。官方換主金鑰是大事，要先讀過公告再手動改 SIGNERS 的指紋。

import { readFileSync, writeFileSync } from "node:fs";
import * as openpgp from "openpgp";

const SIGNERS = [
  {
    id: "tor-browser",
    // https://support.torproject.org/tbb/how-to-verify-signature/
    fingerprint: "EF6E286DDA85EA2A4BA7DE684E2C6E8793298290",
    url: "https://keys.openpgp.org/vks/v1/by-fingerprint/EF6E286DDA85EA2A4BA7DE684E2C6E8793298290",
  },
  {
    id: "tails",
    // https://tails.net/doc/about/openpgp_keys/
    fingerprint: "A490D0F4D311A4153E2BB7CADBB802B258ACD84F",
    url: "https://tails.net/tails-signing.key",
  },
];

const OUT = new URL("../src/tools/software-verify/keys.ts", import.meta.url);
const check = process.argv.includes("--check");
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : "沒有期限");

const keys = {};
for (const signer of SIGNERS) {
  const res = await fetch(signer.url);
  if (!res.ok) throw new Error(`${signer.id}: ${res.status}`);
  const key = await openpgp.readKey({ armoredKey: await res.text() });
  const fingerprint = key.getFingerprint().toUpperCase();
  if (fingerprint !== signer.fingerprint) throw new Error(`${signer.id}: 指紋是 ${fingerprint}，不是 ${signer.fingerprint}`);
  for (const user of key.users) user.otherCertifications = [];
  console.log(`${signer.id} ${fingerprint}，主金鑰期限 ${day(await key.getExpirationTime())}`);
  for (const sub of key.subkeys) {
    const revoked = await sub.isRevoked().catch(() => false);
    console.log(`  子金鑰 ${sub.getFingerprint().toUpperCase()} 建立 ${day(sub.getCreationTime())}，期限 ${day(await sub.getExpirationTime().catch(() => null))}${revoked ? "，已撤銷" : ""}`);
  }
  keys[signer.id] = key.armor().replace(/^Comment: .*\n/gm, "").trim();
}

const body = Object.entries(keys)
  .map(([id, armored]) => `  ${JSON.stringify(id)}: \`${armored}\`,`)
  .join("\n");
const old = readFileSync(OUT, "utf8");
const today = new Date().toISOString().slice(0, 10);
const next = `// 由 scripts/signing-keys.mjs 產生，不要手改。主金鑰的指紋寫在 src/tools/software-verify/index.ts 的 SIGNERS
export const KEYS_CHECKED = "${today}";

export const ARMORED_KEYS: Record<string, string> = {
${body}
};
`;
const strip = (s) => s.replace(/KEYS_CHECKED = "[^"]*"/, "");
if (check) {
  if (strip(old) !== strip(next)) {
    console.log("公鑰跟 keys.ts 不同，執行 node scripts/signing-keys.mjs 更新");
    process.exit(1);
  }
  console.log("公鑰跟 keys.ts 相同");
} else {
  writeFileSync(OUT, next);
  console.log(`寫回 ${OUT.pathname}`);
}

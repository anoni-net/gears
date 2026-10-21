// 把超過 Cloudflare 快取上限的模型檔切成固定大小的段（src/core/models.ts），
// 印出要填進 src/tools/transcribe/models.json 的 parts。原本的檔案留著，自己決定要不要刪。
//
//   node scripts/split-model.mjs <檔案> [每段的 MB，預設 400]
//
// 每段寫成 <檔案>.part0、.part1…，跟原本的檔案放在同一個目錄
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [file, mb = "400"] = process.argv.slice(2);
if (!file) throw new Error("用法：node scripts/split-model.mjs <檔案> [每段的 MB]");
const size = Number(mb) * 1e6;
const total = statSync(file).size;
const fd = openSync(file, "r");
const parts = [];
const whole = createHash("sha256");
for (let at = 0, i = 0; at < total; at += size, i++) {
  const buffer = Buffer.alloc(Math.min(size, total - at));
  readSync(fd, buffer, 0, buffer.length, at);
  writeFileSync(`${file}.part${i}`, buffer);
  whole.update(buffer);
  parts.push({ sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length });
}
closeSync(fd);
console.error(`${basename(file)}：${(total / 1e6).toFixed(1)} MB，切成 ${parts.length} 段，整個檔案的 SHA-256 ${whole.digest("hex")}`);
console.log(JSON.stringify(parts, null, 2));

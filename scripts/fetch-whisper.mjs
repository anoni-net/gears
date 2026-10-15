// 下載逐字稿用的 Whisper 模型到 public/models/whisper/（不進版控），部署前執行一次。
// 版本與每個檔案的 SHA-256 寫在 src/tools/transcribe/models.json，對不上就停下來。
//
//   node scripts/fetch-whisper.mjs          下載 small 與 base
//   node scripts/fetch-whisper.mjs base     只下載 base（瀏覽器測試用）
//
// 來源是 Hugging Face 的 onnx-community，Whisper 的權重是 MIT 授權（OpenAI）。
// 網頁從 anoni.net 自己的網域載入這些檔案，不連 Hugging Face。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const models = JSON.parse(readFileSync(join(root, "src/tools/transcribe/models.json"), "utf8"));
const wanted = process.argv.slice(2);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

for (const [id, model] of Object.entries(models)) {
  if (wanted.length && !wanted.includes(id)) continue;
  for (const [file, hash] of Object.entries(model.files)) {
    const target = join(root, "public/models/whisper", model.dir, file);
    if (existsSync(target) && sha256(readFileSync(target)) === hash) continue;
    const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}：HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    const digest = sha256(data);
    if (!hash) {
      console.log(`${id} ${file} 還沒有記錄 SHA-256：${digest}`);
    } else if (digest !== hash) {
      throw new Error(`${id} ${file} 的 SHA-256 不符：${digest}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    console.log(`${id} ${file}（${(data.length / 1e6).toFixed(1)} MB）`);
  }
}

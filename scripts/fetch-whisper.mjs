// 下載逐字稿用的 Whisper 模型到 public/models/whisper/（不進版控），部署前執行一次。
// 版本與每個檔案的 SHA-256 寫在 src/tools/transcribe/models.json，對不上就停下來。
//
//   node scripts/fetch-whisper.mjs          下載 small、base 與分辨說話者的 CAM++
//   node scripts/fetch-whisper.mjs base     只下載 base（瀏覽器測試用）
//   node scripts/fetch-whisper.mjs speaker  只下載 CAM++
//   --no-webgpu                             不下載 WebGPU 用的 4 位元版（瀏覽器測試用，CI 沒有 GPU）
//   node scripts/fetch-whisper.mjs --hash turbo
//                                           只印出每個檔案的 SHA-256，不存檔（更新 models.json 用）
//
// 來源是 Hugging Face 的 onnx-community，Whisper 的權重是 MIT 授權（OpenAI）。
// 網頁從 anoni.net 自己的網域載入這些檔案，不連 Hugging Face。標成 remote 的大模型例外，
// 讀者選擇之後由網頁直接從 Hugging Face 下載（src/tools/transcribe/remote.ts），這裡不下載。
// 分辨說話者的 CAM++（3D-Speaker，Apache-2.0）取自 sherpa-onnx 的 release，來源與 SHA-256 寫在
// src/tools/transcribe/speaker-model.json，放在 public/models/speaker/。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const models = JSON.parse(readFileSync(join(root, "src/tools/transcribe/models.json"), "utf8"));
const hashOnly = process.argv.includes("--hash");
const noWebgpu = process.argv.includes("--no-webgpu");
const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const speaker = JSON.parse(readFileSync(join(root, "src/tools/transcribe/speaker-model.json"), "utf8"));

async function download(url, hash, target, label) {
  if (!hashOnly && existsSync(target) && sha256(readFileSync(target)) === hash) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}：HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const digest = sha256(data);
  if (hashOnly) {
    console.log(`${label} ${digest} ${data.length}`);
    return;
  }
  if (!hash) {
    console.log(`${label} 還沒有記錄 SHA-256：${digest}`);
  } else if (digest !== hash) {
    throw new Error(`${label} 的 SHA-256 不符：${digest}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`${label}（${(data.length / 1e6).toFixed(1)} MB）`);
}

if (!wanted.length || wanted.includes("speaker")) {
  await download(speaker.url, speaker.sha256, join(root, "public/models/speaker", speaker.dir, speaker.file), `speaker ${speaker.file}`);
}

for (const [id, model] of Object.entries(models)) {
  if (wanted.length ? !wanted.includes(id) : model.remote) continue;
  if (model.remote && !hashOnly) throw new Error(`${id} 由網頁從 Hugging Face 下載，不放進 public/，要確認雜湊請加 --hash`);
  // CPU（wasm）用 dtype 那一組，WebGPU 用 webgpu 那一組，設定檔與詞彙表共用
  for (const [file, hash] of Object.entries({ ...model.files, ...(noWebgpu ? {} : model.webgpu.files) })) {
    const target = join(root, "public/models/whisper", model.dir, file);
    await download(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`, hash, target, `${id} ${file}`);
  }
}

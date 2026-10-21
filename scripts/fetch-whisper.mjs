// 下載逐字稿用的 Whisper 模型到 public/models/whisper/（不進版控），部署前執行一次。
// 版本與每個檔案的 SHA-256 寫在 src/tools/transcribe/models.json，對不上就停下來。
//
//   node scripts/fetch-whisper.mjs          下載 small、base 與分辨說話者的 CAM++
//   node scripts/fetch-whisper.mjs base     只下載 base（瀏覽器測試用）
//   node scripts/fetch-whisper.mjs speaker  只下載 CAM++
//   node scripts/fetch-whisper.mjs sherpa   只下載 sherpa-onnx 的 WebAssembly（Omnilingual 用）
//   --no-webgpu                             不下載 WebGPU 用的 4 位元版（瀏覽器測試用，CI 沒有 GPU）
//   node scripts/fetch-whisper.mjs --hash turbo
//                                           只印出每個檔案的 SHA-256，不存檔（更新 models.json 用）
//   node scripts/fetch-whisper.mjs --manifest deploy/models.txt
//                                           不下載，寫出 small、base（含 WebGPU 版）與 CAM++ 的清單，
//                                           一行一個檔案：網址、SHA-256、models/ 底下的路徑。
//                                           部署時模型不進 build 分支（單一檔案超過 GitHub 的 100 MB），
//                                           m6 的拉取腳本（tools/m6-pull.sh）照清單下載
//
// 來源是 Hugging Face 的 onnx-community，Whisper 的權重是 MIT 授權（OpenAI）。
// 網頁從 anoni.net 自己的網域載入這些檔案（models.json 的 host 是 self）。其他的由網頁直接下載，
// 這裡不下載：hf 是讀者選擇之後從 Hugging Face 下載，assets 是社群轉檔、放在 assets.anoni.net 的
// 模型（src/core/models.ts，上傳方式見 AGENTS.md）。
// 分辨說話者的 CAM++（3D-Speaker，Apache-2.0）取自 sherpa-onnx 的 release，來源與 SHA-256 寫在
// src/tools/transcribe/speaker-model.json，放在 public/models/speaker/。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const models = JSON.parse(readFileSync(join(root, "src/tools/transcribe/models.json"), "utf8"));
const hashOnly = process.argv.includes("--hash");
const noWebgpu = process.argv.includes("--no-webgpu");
const wanted = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--manifest");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const speaker = JSON.parse(readFileSync(join(root, "src/tools/transcribe/speaker-model.json"), "utf8"));
// sherpa-onnx 的 WebAssembly 是社群自己建置的 ES module 版，放在 assets.anoni.net，建置方式寫在那個目錄的
// README.txt。下載到 public/vendor/sherpa/，網頁從自己的網域載入
const sherpa = JSON.parse(readFileSync(join(root, "src/tools/transcribe/sherpa-runtime.json"), "utf8"));

const manifest = process.argv.includes("--manifest") ? process.argv[process.argv.indexOf("--manifest") + 1] : null;
const entries = [];

async function download(url, hash, target, label) {
  if (manifest) {
    entries.push(`${url} ${hash} ${relative(join(root, "public"), target)}`);
    return;
  }
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

// sherpa-onnx 的 WebAssembly 放在 public/vendor/，跟著網站一起部署，不列進模型清單
if (!manifest && (!wanted.length || wanted.includes("sherpa"))) {
  for (const [file, hash] of Object.entries(sherpa.files)) {
    await download(`https://assets.anoni.net/gears/vendor/${sherpa.dir}/${file}`, hash, join(root, "public/vendor/sherpa", file), `sherpa ${file}`);
  }
}

if (!wanted.length || wanted.includes("speaker")) {
  await download(speaker.url, speaker.sha256, join(root, "public/models/speaker", speaker.dir, speaker.file), `speaker ${speaker.file}`);
}

for (const [id, model] of Object.entries(models)) {
  // 別的網域的模型（Hugging Face、assets.anoni.net）由網頁直接下載，不放進 public/
  if (wanted.length ? !wanted.includes(id) : model.host !== "self") continue;
  if (model.host === "assets") throw new Error(`${id} 放在 assets.anoni.net，由網頁直接下載（見 AGENTS.md）`);
  if (model.host === "hf" && !hashOnly) throw new Error(`${id} 由網頁從 Hugging Face 下載，不放進 public/，要確認雜湊請加 --hash`);
  // CPU（wasm）用 dtype 那一組，WebGPU 用 webgpu 那一組，設定檔與詞彙表共用
  for (const [file, hash] of Object.entries({ ...model.files, ...(noWebgpu ? {} : model.webgpu.files) })) {
    const target = join(root, "public/models/whisper", model.dir, file);
    await download(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${file}`, hash, target, `${id} ${file}`);
  }
}

if (manifest) {
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(manifest, `${entries.join("\n")}\n`);
  console.log(`${manifest}：${entries.length} 個檔案`);
}

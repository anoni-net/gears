// 逐字稿的語音偵測：Silero VAD v6.2.3（snakers4/silero-vad，MIT）算出每一窗是說話的機率，在逐字稿的
// Worker 裡執行（src/ui/transcribe.worker.ts）。機率怎麼變成說話的範圍、裝成片段在
// src/tools/transcribe/segments.ts。
//
// 模型是官方的 silero_vad_16k_sequence.onnx（1.2 MB），從自己的網域載入，service worker 用到時才存
// （gears-keep）。整段錄音一次送進去，機率跟逐窗呼叫的 silero_vad.onnx 相同，快約三成（評測見社群工作區的
// research/gears-asr/05-silero-vad.md）。onnxruntime 跟 Transformers.js 共用同一份（同一個檔案路徑，
// Vite 當成同一個模組），不另外下載 WebAssembly，WebAssembly 的位置與執行緒數沿用 Whisper 載入時的設定。
import * as ort from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs";

// 這個檔案只匯入 onnxruntime，模型的網址與大小由參數傳進來：打包時跟 Worker 共用的程式會放進 Worker 的
// 進入點，這裡再匯入它的話，WebKit 會把 Worker 的進入點當成另一份模組再執行一次，蓋掉 onmessage
// （同 src/ui/speaker-embed.ts）

export type VadProbs = (audio: Float32Array) => Promise<Float32Array>;

const WINDOW = 512;
// 每一窗前面接上一窗的最後 64 個取樣，跟官方的 OnnxWrapper 相同
const CONTEXT = 64;
// 一次送進去的窗數（約 96 秒），長錄音分批送，RNN 的狀態（h、c）跨批帶著
const BATCH = 3000;

// url 是模型的網址，size 是它的大小（src/tools/transcribe/vad-model.json）
export async function sileroVad(url: string, size: number): Promise<VadProbs> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`vad model: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== size) throw new Error(`vad model: ${bytes.length} bytes`);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  return async (audio) => {
    const n = Math.ceil(audio.length / WINDOW);
    const probs = new Float32Array(n);
    // 每段錄音從零開始，開頭約 0.1 秒的機率可能偏低，裝片段時前後各留的 0.2 秒會補上
    let h = new ort.Tensor("float32", new Float32Array(128), [1, 1, 128]);
    let c = new ort.Tensor("float32", new Float32Array(128), [1, 1, 128]);
    for (let b0 = 0; b0 < n; b0 += BATCH) {
      const m = Math.min(BATCH, n - b0);
      const row = CONTEXT + WINDOW;
      const input = new Float32Array(m * row);
      for (let k = 0; k < m; k++) {
        const from = (b0 + k) * WINDOW - CONTEXT;
        // 第一窗前面的 64 個取樣補零，最後一窗不足 512 個的部分補零
        const lo = Math.max(0, from);
        const hi = Math.min(audio.length, from + row);
        if (hi > lo) input.set(audio.subarray(lo, hi), k * row + (lo - from));
      }
      const out = await session.run({ input: new ort.Tensor("float32", input, [m, row]), h, c });
      probs.set(out.speech_probs!.data as Float32Array, b0);
      h = out.hn as typeof h;
      c = out.cn as typeof c;
    }
    return probs;
  };
}

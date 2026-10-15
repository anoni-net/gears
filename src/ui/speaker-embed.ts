// 分辨說話者用的聲紋，在逐字稿的 Worker 裡算（src/ui/transcribe.worker.ts）。分群在
// src/tools/transcribe/speakers.ts。
//
// 模型是 3D-Speaker 的 CAM++（中文，Apache-2.0），從自己的網域載入，存進跟 Whisper 同一個
// 不隨版本清掉的快取。特徵用 Transformers.js 的 WeSpeakerFeatureExtractor 算 80 維的 fbank，
// 視窗換成 povey（3D-Speaker 訓練時 torchaudio 的預設）。onnxruntime 跟 Transformers.js 共用
// 同一份（同一個檔案路徑，Vite 當成同一個模組），不另外下載 WebAssembly，執行緒數也沿用。
import * as ort from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs";
import { WeSpeakerFeatureExtractor } from "@huggingface/transformers";

// 這個檔案只匯入 Transformers.js 與 onnxruntime。跟 Worker 共用的程式（模型清單、分群）由
// 參數傳進來：打包時共用的程式會放進 Worker 的進入點，這裡再匯入它的話，WebKit 會把
// Worker 的進入點當成另一份模組再執行一次，蓋掉 onmessage

export type Embedder = (audio: Float32Array) => Promise<Float32Array>;

// url 是模型的網址，bytes 是它的大小（src/tools/transcribe/speaker-model.json）。onBytes 回報
// 下載了多少位元組。回傳的聲紋還沒有 normalize
export async function speakerEmbedder(url: string, size: number, onBytes: (n: number) => void): Promise<Embedder> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`speaker model: HTTP ${response.status}`);
  const reader = response.body!.getReader();
  const bytes = new Uint8Array(size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.set(value.subarray(0, Math.max(0, bytes.length - at)), at);
    at += value.length;
    onBytes(Math.min(at, size));
  }
  if (at !== size) throw new Error(`speaker model: ${at} bytes`);
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  const extractor = new WeSpeakerFeatureExtractor({ sampling_rate: 16000, num_mel_bins: 80, min_num_frames: 9, fbank_centering_span: null });
  const N = 400;
  (extractor as unknown as { window: Float64Array }).window = Float64Array.from({ length: N }, (_, n) => Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)), 0.85));
  return async (audio) => {
    const { input_features } = (await extractor(audio)) as { input_features: { data: Float32Array; dims: number[] } };
    const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", input_features.data, input_features.dims) });
    return out[session.outputNames[0]!]!.data as Float32Array;
  };
}

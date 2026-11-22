/// <reference lib="webworker" />
// 查證的相似圖片第二層（src/ui/dino-detect.ts）的 Worker：載入 DINOv2 small（src/tools/verify/dino-model.ts），
// 收到每張圖整張壓成 224 × 224 的像素（畫面那一側用 canvas 縮好），回覆每張圖正規化之後的 CLS 特徵。
// 只用 CPU 的單執行緒 WebAssembly，跟個資辨識、標點建議一樣。一批算完就由畫面結束這個 Worker，記憶體還給瀏覽器。
//
// 這裡只匯入 dino-model.ts 與 assets-env.ts，Transformers.js 用到時才載入（見 AGENTS.md「逐字稿」的 WebKit 說明）
import { DINO_MODEL, DINO_SIZE, dinoInput, normalize } from "../tools/verify/dino-model.ts";
import { useAssetsModel } from "./assets-env.ts";

export interface DinoRequest {
  images: Uint8ClampedArray[]; // 每張 224 × 224 × 4（RGBA）
}

export type DinoReply =
  | { type: "download"; loaded: number; total: number }
  | { type: "loaded" }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; features: Float32Array[] }
  | { type: "error"; message: string; remote: boolean }; // remote：模型下載失敗

const post = (reply: DinoReply, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, transfer);

self.onmessage = async ({ data }: MessageEvent<DinoRequest>) => {
  let download: { error: Error | null } | null = null;
  try {
    const { AutoModel, Tensor, env } = await import("@huggingface/transformers");
    download = useAssetsModel(env, DINO_MODEL, 1, (loaded) => post({ type: "download", loaded, total: DINO_MODEL.bytes }));
    const net = await AutoModel.from_pretrained(DINO_MODEL.dir, { device: "wasm", dtype: DINO_MODEL.dtype });
    post({ type: "loaded" });
    const features: Float32Array[] = [];
    for (const [i, rgba] of data.images.entries()) {
      const pixel_values = new Tensor("float32", dinoInput(rgba), [1, 3, DINO_SIZE, DINO_SIZE]);
      const out = (await net({ pixel_values })) as Record<string, { data: Float32Array; dims: number[] } | undefined>;
      // CLS 特徵：pooler_output 是經過 LayerNorm 的 CLS，跟評測相同。沒有這個輸出時取 last_hidden_state 的第一個詞元
      const pooled = out.pooler_output?.data ?? out.last_hidden_state!.data.slice(0, out.last_hidden_state!.dims.at(-1));
      features.push(normalize(pooled));
      post({ type: "progress", done: i + 1, total: data.images.length });
    }
    await net.dispose();
    post({ type: "result", features }, features.map((f) => f.buffer));
  } catch (error) {
    post({ type: "error", message: String((error as Error)?.message ?? error), remote: !!download?.error });
  }
};

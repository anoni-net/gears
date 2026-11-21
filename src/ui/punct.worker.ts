/// <reference lib="webworker" />
// 逐字稿的標點建議（src/ui/punct-detect.ts）的 Worker：載入 Horizon-Labs 的標點模型（src/tools/transcribe/punct.ts 的
// PUNCT_MODEL），收到交給模型的文字（已經拿掉原本的標點、轉成小寫），回覆每個位置後面接什麼標點。
// 只用 CPU 的單執行緒 WebAssembly，跟個資辨識一樣。一份逐字稿算完就由畫面結束這個 Worker，記憶體還給瀏覽器。
//
// 這裡只匯入 punct.ts 與 assets-env.ts，Transformers.js 用到時才載入（不讓共用的程式被打包進 Worker 的進入點，
// 見 AGENTS.md「逐字稿」的 WebKit 說明）
import { PUNCT_MODEL, type Prediction, labelMark, tokenEnds, windows } from "../tools/transcribe/punct.ts";
import { useAssetsModel } from "./assets-env.ts";

export interface PunctRequest {
  text: string;
}

export type PunctReply =
  | { type: "download"; loaded: number; total: number }
  | { type: "loaded" }
  | { type: "progress"; done: number; total: number } // 算完幾段（每段 400 個詞元）
  | { type: "result"; predictions: Prediction[] }
  | { type: "error"; message: string; remote: boolean }; // remote：模型下載失敗

const post = (reply: PunctReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);

self.onmessage = async ({ data }: MessageEvent<PunctRequest>) => {
  let download: { error: Error | null } | null = null;
  try {
    const { AutoModelForTokenClassification, AutoTokenizer, Tensor, env } = await import("@huggingface/transformers");
    // 進度用沒有壓縮的大小：讀到的位元組是解壓縮之後的
    download = useAssetsModel(env, PUNCT_MODEL, 1, (loaded) => post({ type: "download", loaded, total: PUNCT_MODEL.bytes }));
    const tok = await AutoTokenizer.from_pretrained(PUNCT_MODEL.dir);
    const net = await AutoModelForTokenClassification.from_pretrained(PUNCT_MODEL.dir, { device: "wasm", dtype: PUNCT_MODEL.dtype });
    post({ type: "loaded" });
    const id2label = (net.config as unknown as { id2label: Record<number, string> }).id2label;
    const text = data.text;
    const tokens = tok.tokenize(text);
    const ids = tok.convert_tokens_to_ids(tokens);
    // 詞元還原不回原文時整次放棄，位置錯了標點會插在錯的地方
    const ends = tokenEnds(tokens, text);
    if (!ends) throw new Error("punct: token offsets do not match the text");
    // <bos> 與 <eos>：tokenizer 的後處理會在前後加上，取第一個與最後一個
    const special = tok.encode("a");
    const [bos, eos] = [special[0]!, special.at(-1)!];
    // 同一個結尾位置有好幾個詞元時（位元組備援拆開的字）用最後一個，跟評測相同
    const byEnd = new Map<number, Prediction[1] | null>();
    const parts = windows(ids.length);
    for (const [i, { start, end, keepTo }] of parts.entries()) {
      const x = [bos, ...ids.slice(start, end), eos];
      const input_ids = new Tensor("int64", BigInt64Array.from(x.map(BigInt)), [1, x.length]);
      const attention_mask = new Tensor("int64", new BigInt64Array(x.length).fill(1n), [1, x.length]);
      const { logits } = (await net({ input_ids, attention_mask })) as { logits: { data: Float32Array; dims: number[] } };
      const labels = logits.dims[2]!;
      for (let k = start; k < keepTo; k++) {
        const row = (k - start + 1) * labels;
        let best = 0;
        for (let j = 1; j < labels; j++) if (logits.data[row + j]! > logits.data[row + best]!) best = j;
        byEnd.set(ends[k]!, labelMark(id2label[best] ?? ""));
      }
      post({ type: "progress", done: i + 1, total: parts.length });
    }
    const predictions: Prediction[] = [];
    for (const [at, mark] of byEnd) if (mark) predictions.push([at, mark]);
    post({ type: "result", predictions });
  } catch (error) {
    post({ type: "error", message: String((error as Error)?.message ?? error), remote: !!download?.error });
  }
};

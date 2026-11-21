// 個資辨識模型（nym-pii，src/tools/redact/pii-model.ts）在 Worker 裡的載入與辨識，裝置量測（pii-bench.worker.ts）
// 與遮蔽（pii.worker.ts）共用。只能在 Worker 裡匯入。
//
// 模型從 assets.anoni.net 下載（onion 版是同一個網站的 /models/assets/），Transformers.js 的設定在 assets-env.ts，
// 逐字稿的標點建議也用它。下載的檔案存在 transformers-cache，量測頁與遮蔽用同一份
import { useAssetsModel } from "./assets-env.ts";
import { type Decoder, PII_MODEL, type PiiSpan, align, argmax, groupSpans, labelKind } from "../tools/redact/pii-model.ts";

export interface PiiLoadOptions {
  device: "wasm" | "webgpu";
  threads: number;
  // 下載進度：這次實際下載的位元組與清單上的總量，已經在快取裡的檔案不會經過這裡
  onDownload?: (loaded: number, total: number) => void;
}

export interface PiiRuntime {
  // text 裡找到的範圍與詞元數。超過 8192 個詞元的部分會被截掉，呼叫的一方要先分塊（chunkLines）
  detect(text: string): Promise<{ spans: PiiSpan[]; tokens: number }>;
  downloaded: number;
  dispose(): Promise<void>;
}

export async function loadPii({ device, threads, onDownload }: PiiLoadOptions): Promise<PiiRuntime> {
  const { AutoModelForTokenClassification, AutoTokenizer, env } = await import("@huggingface/transformers");
  const download = useAssetsModel(env, PII_MODEL, threads, onDownload);

  const tokenizer = await AutoTokenizer.from_pretrained(PII_MODEL.dir);
  const net = await AutoModelForTokenClassification.from_pretrained(PII_MODEL.dir, { device, dtype: PII_MODEL.dtype });
  const id2label = (net.config as unknown as { id2label: Record<number, string> }).id2label;

  return {
    get downloaded() {
      return download.downloaded;
    },
    async detect(text: string) {
      const inputs = tokenizer(text, { truncation: true });
      const { logits } = (await net(inputs)) as { logits: { data: Float32Array; dims: number[] } };
      const [, n, labels] = logits.dims as [number, number, number];
      // 每個詞元取分數最高的標籤，詞元對回原文，相鄰、同一類的合成一個範圍
      const ids = (inputs.input_ids.tolist() as number[][])[0]!.map(Number);
      const at = align(tokenizer as unknown as Decoder, text, ids);
      const items = [];
      for (let j = 0; j < n; j++) {
        const range = at[j];
        if (!range) continue;
        const kind = labelKind(id2label[argmax(logits.data.subarray(j * labels, (j + 1) * labels))] ?? "");
        if (kind) items.push({ kind, start: range[0], end: range[1] });
      }
      return { spans: groupSpans(text, items), tokens: n };
    },
    dispose: async () => {
      await net.dispose();
    },
  };
}

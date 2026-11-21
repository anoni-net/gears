// 個資辨識模型（nym-pii，src/tools/redact/pii-model.ts）在 Worker 裡的載入與辨識，裝置量測（pii-bench.worker.ts）
// 與遮蔽（pii.worker.ts）共用。只能在 Worker 裡匯入。
//
// 模型從 assets.anoni.net 下載（onion 版是同一個網站的 /models/assets/），Transformers.js 的設定照
// llm-bench.worker.ts 的社群轉檔模型：只下載清單上的檔案、逐一比對 SHA-256，模型目錄以外的請求一律不送，
// WebAssembly 用 ?url 從自己的網域載入。下載的檔案由 Transformers.js 存在 transformers-cache，量測頁與遮蔽
// 用同一份，service worker 換版本時不會清掉（只清 gears- 開頭的快取）
import asyncifyMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url";
import asyncifyWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url";
import plainMjs from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import plainWasm from "../../node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { ASSETS_MODELS, assetsUrl, downloadVerified } from "../core/models.ts";
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
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  // WebAssembly 的載入程式不存快取：存了之後改用 blob: 網址載入，CSP 的 script-src 不允許
  env.useWasmCache = false;
  // assets.anoni.net 上的目錄當模型名稱，目錄名稱帶著 commit，內容不會變
  env.remoteHost = ASSETS_MODELS;
  env.remotePathTemplate = "{model}/";

  const progress: Record<string, [number, number]> = {};
  let downloaded = 0;
  // 清單外的檔案（Transformers.js 會試著讀一些選用的設定檔）當成不存在。對不上 SHA-256 時丟出錯誤，不存進快取
  const fromAssets = async (file: string): Promise<Response> => {
    const sha256 = PII_MODEL.files[file];
    if (!sha256) return new Response(null, { status: 404 });
    let last = 0;
    const data = await downloadVerified({ url: (name) => assetsUrl(PII_MODEL.dir, name), file, sha256 }, (n, total) => {
      downloaded += n - last;
      last = n;
      progress[file] = [n, total];
      const sum = Object.values(progress).reduce((a, [l, t]) => [a[0]! + l, a[1]! + t], [0, 0]);
      onDownload?.(sum[0]!, sum[1]!);
    });
    return new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(data.length) } });
  };
  const dir = new URL(assetsUrl(PII_MODEL.dir, ""), self.location.href).href;
  env.fetch = (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), self.location.href).href;
    if (!url.startsWith(dir)) return Promise.resolve(new Response(null, { status: 404 }));
    return fromAssets(url.slice(dir.length).split("?")[0]!).catch((error: Error) => {
      throw new Error(`${error.message}（${url}）`);
    });
  };
  const wasm = env.backends.onnx.wasm!;
  const asyncify = JSON.stringify(wasm.wasmPaths ?? "").includes(".asyncify");
  wasm.wasmPaths = asyncify ? { mjs: asyncifyMjs, wasm: asyncifyWasm } : { mjs: plainMjs, wasm: plainWasm };
  wasm.numThreads = self.crossOriginIsolated ? threads : 1;

  const tokenizer = await AutoTokenizer.from_pretrained(PII_MODEL.dir);
  const net = await AutoModelForTokenClassification.from_pretrained(PII_MODEL.dir, { device, dtype: PII_MODEL.dtype });
  const id2label = (net.config as unknown as { id2label: Record<number, string> }).id2label;

  return {
    get downloaded() {
      return downloaded;
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

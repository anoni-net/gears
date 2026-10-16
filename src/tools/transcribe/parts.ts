// 切成好幾段的模型檔。自己轉檔的模型放在社群的伺服器，經過 Cloudflare，免費方案的單一檔案
// 快取上限是 512 MB，超過的檔案用 scripts/split-model.mjs 切成固定大小的段（<檔名>.part0、
// .part1…），models.json 的 parts 記下每段的 SHA-256 與大小。
//
// Worker 依序下載每一段、比對 SHA-256，直接寫進預先配置好的一整塊記憶體，不另外複製一次，
// 接回來的就是原本的檔案（src/ui/transcribe.worker.ts）。service worker 一段一段存。

export interface Part {
  sha256: string;
  bytes: number;
}

export const partName = (file: string, index: number) => `${file}.part${index}`;

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

// 錯誤訊息的開頭，畫面靠它分辨是模型檔有問題
export const PART_ERROR = "Model part";

// fetchPart 取得第幾段的回應，onBytes 回報接好了多少位元組
export async function joinParts(parts: Part[], fetchPart: (index: number) => Promise<Response>, onBytes: (n: number) => void = () => {}): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.bytes, 0));
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    const response = await fetchPart(index);
    if (!response.ok || !response.body) throw new Error(`${PART_ERROR} ${index}: HTTP ${response.status}`);
    const reader = response.body.getReader();
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > part.bytes) throw new Error(`${PART_ERROR} ${index}: longer than ${part.bytes} bytes`);
      out.set(value, offset + at);
      at += value.length;
      onBytes(offset + at);
    }
    if (at !== part.bytes) throw new Error(`${PART_ERROR} ${index}: ${at} of ${part.bytes} bytes`);
    const digest = hex(await crypto.subtle.digest("SHA-256", out.subarray(offset, offset + at)));
    if (digest !== part.sha256) throw new Error(`${PART_ERROR} ${index}: SHA-256 mismatch`);
    offset += at;
  }
  return out;
}

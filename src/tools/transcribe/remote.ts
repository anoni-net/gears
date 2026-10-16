// 從別的網域下載的模型（models.json 的 host）：
// - hf：large-v3-turbo，讀者在畫面上選擇之後從 Hugging Face 下載，網址鎖定 commit
// - assets：社群自己轉檔的模型（泰語、Breeze），放在 assets.anoni.net，大檔案切成好幾段
//   （src/tools/transcribe/parts.ts）
// small、base 與分辨說話者的模型（host 是 self）跟工作台同一個網域，由 service worker 快取。
//
// 每個檔案下載完比對 SHA-256，對不上就不存、停下來。不帶 cookie 與 Referer。

export const hfUrl = (repo: string, revision: string, file: string) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;

// 社群轉檔的模型，目錄名稱帶著原始模型的 commit，內容不會變
export const ASSETS_MODELS = "https://assets.anoni.net/gears/models/";
export const assetsUrl = (dir: string, file: string) => `${ASSETS_MODELS}${dir}/${file}`;

// 下載失敗的錯誤訊息都以這個開頭，畫面靠它分辨是下載出了問題
export const REMOTE_ERROR = "Model download";

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

// 讀完整個回應並比對 SHA-256。onBytes 回報目前讀到的位元組數。
// 有 Content-Length 時先配置好整塊記憶體，大檔案不必另外複製一次
export async function readVerified(response: Response, sha256: string, onBytes: (n: number) => void = () => {}): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(response.headers.get("content-length")) || 0;
  const reader = response.body!.getReader();
  let buffer: Uint8Array<ArrayBuffer> = new Uint8Array(length);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > buffer.length) {
      const bigger = new Uint8Array(Math.max(at + value.length, buffer.length * 2));
      bigger.set(buffer.subarray(0, at));
      buffer = bigger;
    }
    buffer.set(value, at);
    at += value.length;
    onBytes(at);
  }
  const data = at === buffer.length ? buffer : buffer.slice(0, at);
  if (hex(await crypto.subtle.digest("SHA-256", data)) !== sha256) throw new Error(`${REMOTE_ERROR}: SHA-256 mismatch`);
  return data;
}

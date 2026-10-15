// 從 Hugging Face 下載的大模型。small 與 base 從 anoni.net 自己的網域載入，大模型的流量太重，
// 讀者在畫面上選擇之後才從 Hugging Face 下載（見 AGENTS.md「逐字稿」）。
//
// 網址鎖定 models.json 記錄的 commit，每個檔案下載完比對 SHA-256，對不上就不存、停下來。
// 不帶 cookie 與 Referer，Hugging Face 收到的是讀者的 IP、瀏覽器與下載了哪個檔案。

export const hfUrl = (repo: string, revision: string, file: string) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;

// 錯誤訊息都以 Hugging Face 開頭，畫面靠它分辨是下載出了問題
export const REMOTE_ERROR = "Hugging Face";

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

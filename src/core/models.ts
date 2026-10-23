import { IS_ONION } from "../site.ts";

// 模型檔的下載、比對 SHA-256、切段與快取，逐字稿（transcribe.worker.ts、sherpa.worker.ts）、
// 逐字稿的畫面與裝置量測的語言模型（llm-bench.worker.ts）共用（#142）。
//
// 模型從哪裡下載寫在各自 models.json 的 host：
// - self：工作台自己的網域，由 service worker 快取
// - hf：Hugging Face，網址鎖定 commit（逐字稿的 large-v3-turbo、量測頁的模型）
// - assets：社群自己轉檔的模型，放在 assets.anoni.net，大檔案切成好幾段
// 後兩種由 Worker 下載，每個檔案比對 SHA-256，對不上就不存、停下來。不帶 cookie 與 Referer。
//
// 分辨說話者的模型（src/ui/speaker-embed.ts）不用這裡：那個檔案只能匯入 Transformers.js 與
// onnxruntime，見 AGENTS.md 的「逐字稿」

export const hfUrl = (repo: string, revision: string, file: string) => `https://huggingface.co/${repo}/resolve/${revision}/${file}`;

// 社群轉檔的模型，目錄名稱帶著原始模型的 commit，內容不會變。onion 版由同一個 onion 網站
// 提供（m6 的 nginx 指到同一份檔案），不經過 clearnet
export const ASSETS_MODELS = IS_ONION ? "/models/assets/" : "https://assets.anoni.net/gears/models/";
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

// --- 切成好幾段的模型檔 ---
//
// 自己轉檔的模型放在社群的伺服器，經過 Cloudflare，免費方案的單一檔案快取上限是 512 MB，
// 超過的檔案用 scripts/split-model.mjs 切成固定大小的段（<檔名>.part0、.part1…），
// models.json 的 parts 記下每段的 SHA-256 與大小。
//
// 依序下載每一段、比對 SHA-256，直接寫進預先配置好的一整塊記憶體，不另外複製一次，
// 接回來的就是原本的檔案。service worker 一段一段存。

export interface Part {
  sha256: string;
  bytes: number;
}

export const partName = (file: string, index: number) => `${file}.part${index}`;

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

// --- 下載 ---

// 不帶 cookie 與 Referer，不寫 HTTP 快取（模型檔最大 157 MB，無痕視窗的記憶體快取寫不下時
// 整個請求會失敗）。連不上時的錯誤以 REMOTE_ERROR 開頭
export const remoteGet = (url: string) =>
  fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" }).catch((error: Error) => {
    throw new Error(`${REMOTE_ERROR}: ${error.message} (${url})`);
  });

export interface RemoteFile {
  url: (name: string) => string; // 檔名換成下載的網址，切段的檔案每一段各呼叫一次
  file: string;
  sha256: string;
  parts?: Part[];
}

// 下載一個模型檔並比對 SHA-256，切成好幾段的檔案逐段比對、接回來。onBytes 回報讀到的
// 位元組數與檔案的大小（單一檔案靠 Content-Length，沒有時是 0）。錯誤都以 REMOTE_ERROR 開頭
export async function downloadVerified({ url, file, sha256, parts }: RemoteFile, onBytes: (n: number, total: number) => void = () => {}): Promise<Uint8Array<ArrayBuffer>> {
  if (parts) {
    const total = parts.reduce((n, p) => n + p.bytes, 0);
    return joinParts(parts, (i) => remoteGet(url(partName(file, i))), (n) => onBytes(n, total)).catch((error: Error) => {
      throw new Error(error.message.startsWith(REMOTE_ERROR) ? error.message : `${REMOTE_ERROR}: ${error.message}`);
    });
  }
  const response = await remoteGet(url(file));
  if (!response.ok) throw new Error(`${REMOTE_ERROR}: HTTP ${response.status} (${file})`);
  const length = Number(response.headers.get("content-length")) || 0;
  return readVerified(response, sha256, (n) => onBytes(n, length));
}

// --- 不隨版本清掉的快取 ---
//
// 逐字稿的模型存在 gears-models，換新版本時不必重新下載。service worker 存自己網域的模型，
// 別的網域的由 Worker 下載之後存進同一個快取，網址一律用自己網域的路徑，畫面判斷
// 「已下載」與刪除時不必分開處理。清單以外的在新版本接手時由 service worker 刪掉

export const MODEL_CACHE = "gears-models";

const octets = (data: Uint8Array<ArrayBuffer>) => new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(data.length) } });

// 同一個檔案同時有好幾個請求時共用同一次下載。存進快取的回傳 null，存不進去的（無痕視窗的
// 配額很小）把內容留在這裡，載入完由呼叫的人 forgetDownloads() 放掉
const downloads = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();

export const forgetDownloads = () => downloads.clear();

// 先找快取，沒有就 download()、存進快取。key 是快取裡的網址。Firefox 的無痕視窗不能用
// Cache API，那時每次都重新下載
export async function cachedModel(key: string, download: () => Promise<Uint8Array<ArrayBuffer>>, retry = true): Promise<Response> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  const hit = await cache?.match(key);
  if (hit) return hit;
  let job = downloads.get(key);
  if (!job) {
    job = download().then((data) => {
      if (!cache) return data;
      return cache.put(key, octets(data)).then(
        () => null,
        (error: Error) => {
          console.warn("[gears] 模型存不進快取：", key, error.message);
          return data;
        },
      );
    });
    downloads.set(key, job);
  }
  const data = await job;
  if (data) return octets(data);
  const stored = await cache?.match(key);
  if (stored) return stored;
  // 存進快取之後又被刪掉（讀者刪除了模型），重新下載一次
  downloads.delete(key);
  if (!retry) throw new Error(`${REMOTE_ERROR}: not in the cache (${key})`);
  return cachedModel(key, download, false);
}

// 快取裡有沒有這個網址
export async function isCached(key: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  return !!(await cache?.match(key));
}

// 刪掉快取裡以 prefix 開頭的網址，一個模型的目錄
export async function removeCached(prefix: string): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  for (const request of await cache.keys()) if (request.url.startsWith(prefix)) await cache.delete(request);
}

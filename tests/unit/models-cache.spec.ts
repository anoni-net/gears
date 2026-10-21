import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { MODEL_CACHE, REMOTE_ERROR, cachedModel, downloadVerified, forgetDownloads, isCached, partName, removeCached } from "../../src/core/models.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// 記憶體裡的 Cache API，只做模型模組用到的幾個方法。full 時 put 失敗（無痕視窗的配額很小）
class MemoryCache {
  entries = new Map<string, Uint8Array>();
  full = false;
  async match(key: string) {
    const data = this.entries.get(key);
    return data ? new Response(data.slice()) : undefined;
  }
  async put(key: string, response: Response) {
    if (this.full) throw new Error("QuotaExceededError");
    this.entries.set(key, new Uint8Array(await response.arrayBuffer()));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(key: Request | string) {
    return this.entries.delete(typeof key === "string" ? key : key.url);
  }
}

let cache: MemoryCache;
let opened: string[];
test.beforeEach(() => {
  cache = new MemoryCache();
  opened = [];
  (globalThis as { caches?: unknown }).caches = {
    open: async (name: string) => {
      opened.push(name);
      return cache;
    },
  };
  forgetDownloads();
});
test.afterEach(() => {
  delete (globalThis as { caches?: unknown }).caches;
});

const KEY = "https://example.org/gears/models/whisper/m/onnx/model.onnx";
const DATA = new Uint8Array([1, 2, 3, 4]);

test("沒有快取時下載、存進 gears-models，第二次直接讀快取", async () => {
  let downloads = 0;
  const download = async () => {
    downloads++;
    return DATA.slice();
  };
  expect(new Uint8Array(await (await cachedModel(KEY, download)).arrayBuffer())).toEqual(DATA);
  forgetDownloads();
  expect(new Uint8Array(await (await cachedModel(KEY, download)).arrayBuffer())).toEqual(DATA);
  expect(downloads).toBe(1);
  expect(opened.every((name) => name === MODEL_CACHE)).toBe(true);
  expect(await isCached(KEY)).toBe(true);
});

test("同一個檔案同時有好幾個請求時共用一次下載", async () => {
  let downloads = 0;
  let release = () => {};
  const download = () =>
    new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
      downloads++;
      release = () => resolve(DATA.slice());
    });
  const both = Promise.all([cachedModel(KEY, download), cachedModel(KEY, download)]);
  await new Promise((r) => setTimeout(r, 10));
  release();
  const responses = await both;
  for (const r of responses) expect(new Uint8Array(await r.arrayBuffer())).toEqual(DATA);
  expect(downloads).toBe(1);
});

test("存不進快取時這次照樣使用，沒有 Cache API 時每次都下載", async () => {
  cache.full = true;
  expect(new Uint8Array(await (await cachedModel(KEY, async () => DATA.slice())).arrayBuffer())).toEqual(DATA);
  expect(await isCached(KEY)).toBe(false);
  forgetDownloads();
  (globalThis as { caches?: unknown }).caches = { open: () => Promise.reject(new Error("SecurityError")) };
  expect(new Uint8Array(await (await cachedModel(KEY, async () => DATA.slice())).arrayBuffer())).toEqual(DATA);
  expect(await isCached(KEY)).toBe(false);
});

test("存進快取之後被刪掉，再要一次時重新下載", async () => {
  let downloads = 0;
  const download = async () => {
    downloads++;
    return DATA.slice();
  };
  await cachedModel(KEY, download);
  await removeCached("https://example.org/gears/models/whisper/m/");
  expect(await isCached(KEY)).toBe(false);
  // 共用下載的紀錄還在（沒有 forgetDownloads），一樣要重新下載
  expect(new Uint8Array(await (await cachedModel(KEY, download)).arrayBuffer())).toEqual(DATA);
  expect(downloads).toBe(2);
});

test("刪除只刪那個模型的目錄", async () => {
  await cachedModel(KEY, async () => DATA.slice());
  await cachedModel("https://example.org/gears/models/whisper/other/a.onnx", async () => DATA.slice());
  await removeCached("https://example.org/gears/models/whisper/m/");
  expect([...cache.entries.keys()]).toEqual(["https://example.org/gears/models/whisper/other/a.onnx"]);
});

// 換掉 fetch，依網址回應
function serve(files: Record<string, Uint8Array>) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const data = files[url];
    return data ? new Response(data.slice(), { headers: { "content-length": String(data.length) } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  return { requests, restore: () => (globalThis.fetch = original) };
}

test("下載單一檔案：不帶 cookie 與 Referer，回報大小，比對 SHA-256", async () => {
  const server = serve({ "https://assets.example/m/model.onnx": DATA });
  try {
    const seen: [number, number][] = [];
    const data = await downloadVerified({ url: (name) => `https://assets.example/m/${name}`, file: "model.onnx", sha256: sha256(DATA) }, (n, total) => seen.push([n, total]));
    expect(data).toEqual(DATA);
    expect(seen.at(-1)).toEqual([4, 4]);
    expect(server.requests[0]!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    await expect(downloadVerified({ url: (name) => `https://assets.example/m/${name}`, file: "missing.onnx", sha256: sha256(DATA) })).rejects.toThrow(
      new RegExp(`^${REMOTE_ERROR}: HTTP 404`),
    );
  } finally {
    server.restore();
  }
});

test("下載切段的檔案：逐段接回來，錯誤以 REMOTE_ERROR 開頭", async () => {
  const whole = new Uint8Array(10).map((_, i) => i);
  const parts = [
    { sha256: sha256(whole.subarray(0, 6)), bytes: 6 },
    { sha256: sha256(whole.subarray(6)), bytes: 4 },
  ];
  const at = (name: string) => `https://assets.example/m/${name}`;
  const server = serve({ [at(partName("w.onnx_data", 0))]: whole.subarray(0, 6), [at(partName("w.onnx_data", 1))]: whole.subarray(6) });
  try {
    const seen: [number, number][] = [];
    expect(await downloadVerified({ url: at, file: "w.onnx_data", sha256: "", parts }, (n, total) => seen.push([n, total]))).toEqual(whole);
    expect(seen.at(-1)).toEqual([10, 10]);
    const wrong = [parts[0]!, { ...parts[1]!, sha256: "0".repeat(64) }];
    await expect(downloadVerified({ url: at, file: "w.onnx_data", sha256: "", parts: wrong })).rejects.toThrow(new RegExp(`^${REMOTE_ERROR}: Model part 1: SHA-256 mismatch`));
  } finally {
    server.restore();
  }
});

// 檔案工作台的 service worker：讓工作台第一次開啟之後，沒有網路也能使用。
// 建置時由 vite.config.ts 的 serviceWorker() 填入版本與檔案清單，輸出成 /gears/sw.js。
//
// 只存工作台自己的檔案（頁面、程式、圖示、165 清單），讀者放進暫存區的檔案從來不經過
// 這裡，也不會被寫進任何快取。人臉與文字辨識的模型很大，用到時才存，換版本時留著。

const VERSION = "__VERSION__";
const FILES = __FILES__;
const BASE = "__BASE__";
const CACHE = `gears-${VERSION}`;
// 逐字稿的 Whisper 模型（80 到 250 MB）與分辨說話者的 CAM++（28 MB）另外存一個不隨版本清掉的快取，換新版本時不必重新下載。
// 網址帶著模型的版本，清單以外的（舊版本的模型）在新版本接手時刪掉
const MODELS = "gears-models";
const MODEL_DIRS = __MODEL_DIRS__.map((dir) => `${BASE}${dir}`);
// 用到時才存的大檔案：人臉與文字辨識的模型、onnxruntime 與 c2pa 的 WebAssembly、
// pdf.js 的 CMap 與字型。檔名對內容的雜湊，建置時算好（vite.config.ts 的 serviceWorker()）。
// 存在不隨版本清掉的快取，存的時候在回應加上 HASH_HEADER，換版本時內容變了或不在清單上的才刪掉，
// 一天部署好幾次也不必每次重新下載約 23 MB（#142）
const LAZY = __LAZY__;
const KEEP = "gears-keep"; // 跟 src/core/storage.ts 的 KEEP_CACHE 一致
const HASH_HEADER = "x-gears-hash";
const lazyHash = (pathname) => (pathname.startsWith(BASE) ? LAZY[pathname.slice(BASE.length)] : undefined);

// index.html 存成資料夾的網址，瀏覽器開啟的是 /gears/qrcode/ 不是 /gears/qrcode/index.html
const url = (file) => BASE + file.replace(/(^|\/)index\.html$/, "$1");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(url))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("gears-") && ![CACHE, MODELS, KEEP].includes(key)).map((key) => caches.delete(key))))
      // 沒下載過模型就不建立這個快取
      .then(async () => {
        if (!(await caches.has(MODELS))) return;
        const cache = await caches.open(MODELS);
        for (const request of await cache.keys()) {
          if (!MODEL_DIRS.some((dir) => new URL(request.url).pathname.startsWith(dir))) await cache.delete(request);
        }
      })
      .then(async () => {
        if (!(await caches.has(KEEP))) return;
        const cache = await caches.open(KEEP);
        for (const request of await cache.keys()) {
          const hash = lazyHash(new URL(request.url).pathname);
          const response = await cache.match(request);
          if (!hash || response?.headers.get(HASH_HEADER) !== hash) await cache.delete(request);
        }
      })
      .then(() => self.clients.claim()),
  );
});

// 換版本時暫放的暫存區（src/ui/offline.ts）。只放在這個 service worker 的記憶體裡，不寫進快取或任何儲存空間，
// 重新載入的頁面拿走就放掉，最多留 HOLD_MS
let held = null;
let release = () => {};
const HOLD_MS = 60_000;

// 讀者在畫面上按「重新載入」時才換成新版本，避免同一個分頁混用新舊程式
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "skipWaiting") return self.skipWaiting();
  const reply = event.ports[0];
  if (data?.type === "hold") {
    release();
    held = data.tray;
    // 瀏覽器會停掉閒置的 service worker，暫放的檔案跟著消失。用 waitUntil 撐到頁面拿走，或時間到為止
    event.waitUntil(
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          held = null;
          resolve();
        }, HOLD_MS);
        release = () => {
          clearTimeout(timer);
          resolve();
        };
      }),
    );
    reply?.postMessage({ ok: true });
  } else if (data?.type === "take") {
    reply?.postMessage({ tray: held });
    held = null;
    release();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method !== "GET" || target.origin !== location.origin || !target.pathname.startsWith(BASE)) return;
  event.respondWith(respond(request, target, event));
});

async function respond(request, target, event) {
  if (MODEL_DIRS.some((dir) => target.pathname.startsWith(dir))) {
    const cached = await caches.match(request, { cacheName: MODELS });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(MODELS).then((cache) => cache.put(request, copy));
    }
    return response;
  }
  // 模組腳本的請求帶著 Origin，伺服器的回應常有 Vary: Origin，預先存的那份會對不上
  const options = { ignoreSearch: true, ignoreVary: true };
  const hash = lazyHash(target.pathname);
  if (hash) {
    const kept = await caches.match(request, { ...options, cacheName: KEEP });
    if (kept?.headers.get(HASH_HEADER) === hash) return kept;
  }
  const cached = await caches.match(request, { ...options, cacheName: CACHE });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (hash && response.status === 200) event.waitUntil(keep(request, response.clone(), hash));
    return response;
  } catch (error) {
    // 沒有網路時，沒存過的頁面改用首頁，由 src/router.ts 判斷要顯示哪個工具
    if (request.mode === "navigate") {
      const home = await caches.match(BASE, { cacheName: CACHE });
      if (home) return home;
    }
    throw error;
  }
}

// 存進不隨版本清掉的快取，回應加上內容的雜湊，換版本時比對
async function keep(request, response, hash) {
  try {
    const headers = new Headers(response.headers);
    headers.set(HASH_HEADER, hash);
    // 讀出來的內容已經解壓縮，原本的壓縮方式與長度對不上
    headers.delete("content-encoding");
    headers.delete("content-length");
    const body = await response.blob();
    const cache = await caches.open(KEEP);
    await cache.put(request.url, new Response(body, { status: response.status, statusText: response.statusText, headers }));
  } catch {
    // 存不進去（無痕視窗的配額很小）時下次再從網路取得
  }
}

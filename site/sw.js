// 檔案工作台的 service worker：讓工作台第一次開啟之後，沒有網路也能使用。
// 建置時由 vite.config.ts 的 serviceWorker() 填入版本與檔案清單，輸出成 /gears/sw.js。
//
// 只存工作台自己的檔案（頁面、程式、圖示、165 清單），讀者放進暫存區的檔案從來不經過
// 這裡，也不會被寫進任何快取。人臉與文字辨識的模型很大，用到時才存。

const VERSION = "28fcc793529dcb48";
const FILES = ["age-keygen/index.html","assets/AgeEditors-Duy83PCu.js","assets/AgeKeyFields-LSoNlNX2.js","assets/EmailTool-Tuzq0ULT.js","assets/HeicConvert-C_wSR5Ve.js","assets/KeygenTool-DYnkrQf6.js","assets/PassphraseTool-A3iQPqPY.js","assets/PdfPagesEditor-5BnRJ2dT.js","assets/QrReadTool-Bd3ltzmg.js","assets/QrTool-BGbLSBP5.js","assets/RedactEditor-Dr3sqrRv.js","assets/TextCryptTool-Uo9phN1n.js","assets/TranscribeEditor-B2V_DwjV.js","assets/UrlCheckTool-CJVpRV-V.js","assets/VerifyTool-C5SMlPYu.js","assets/age-BRthVgOk.js","assets/asian-diceware-7776-B6etXB3N.js","assets/bytes-D67tNpLs.js","assets/cn2t-Dj0Mm1HJ.js","assets/heif-wasm-5j_bKUa8.js","assets/index-DJMhiRKD.css","assets/index-DLlvC5M2.js","assets/jsQR-BFC9zyzC.js","assets/keep-exif-yEZusPwc.js","assets/libheif-BfiPCEgt.wasm","assets/ort.wasm.bundle.min-L9saZmiC.js","assets/pdf-compare-BsbGbou3.js","assets/pdf-lib-3s6WMkXa.js","assets/pdf-pages-3i-yQ29B.js","assets/pdf-pages-Bl9DHYPw.js","assets/pdf.worker.min-CjEcRF4W.mjs","assets/png-encode-DpcVZ7_k.js","assets/preload-helper-CMmJIFbb.js","assets/qrcode-_LCh4DA7.js","assets/redact-detect-BVP5ziwB.js","assets/rolldown-runtime-BCiCTKAo.js","assets/save-fAAjJd0V.js","assets/scam-list-loader-CZE0Pu9s.js","assets/sha2-DOkirqsL.js","assets/sherpa.worker-BZo8u_Mf.js","assets/speaker-embed-kccPfA50.js","assets/tesseract-BoiZRbaI.js","assets/tool-DwGqnoVc.js","assets/tools-BkuDVcDO.js","assets/transcribe.worker-BhooBcUE.js","assets/transformers.web-B9nk_0_c.js","assets/webp-D2A3tYU6.js","data/165.txt","decrypt/index.html","email-check/index.html","en/age-keygen/index.html","en/decrypt/index.html","en/email-check/index.html","en/encrypt/index.html","en/heic-to-jpeg/index.html","en/index.html","en/passphrase/index.html","en/pdf-pages/index.html","en/qr-read/index.html","en/qrcode/index.html","en/redact/index.html","en/strip-metadata/index.html","en/text-crypt/index.html","en/transcribe/index.html","en/url-check/index.html","en/verify/index.html","encrypt/index.html","favicon.svg","heic-to-jpeg/index.html","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","logo-wordmark-tonal.svg","logo-wordmark-white.svg","manifest.webmanifest","passphrase/index.html","pdf-pages/index.html","qr-read/index.html","qrcode/index.html","redact/index.html","strip-metadata/index.html","text-crypt/index.html","transcribe/index.html","url-check/index.html","verify/index.html","zh-cn/age-keygen/index.html","zh-cn/decrypt/index.html","zh-cn/email-check/index.html","zh-cn/encrypt/index.html","zh-cn/heic-to-jpeg/index.html","zh-cn/index.html","zh-cn/passphrase/index.html","zh-cn/pdf-pages/index.html","zh-cn/qr-read/index.html","zh-cn/qrcode/index.html","zh-cn/redact/index.html","zh-cn/strip-metadata/index.html","zh-cn/text-crypt/index.html","zh-cn/transcribe/index.html","zh-cn/url-check/index.html","zh-cn/verify/index.html"];
const BASE = "/gears/";
const CACHE = `gears-${VERSION}`;
const RUNTIME = `gears-${VERSION}-runtime`;
// 逐字稿的 Whisper 模型（80 到 250 MB）與分辨說話者的 CAM++（28 MB）另外存一個不隨版本清掉的快取，換新版本時不必重新下載。
// 網址帶著模型的版本，清單以外的（舊版本的模型）在新版本接手時刪掉
const MODELS = "gears-models";
const MODEL_DIRS = ["models/whisper/whisper-small-36050c4/","models/whisper/whisper-base-1846881/","models/whisper/whisper-large-v3-turbo-360ebcd/","models/whisper/th-distill-small-14d3037/","models/whisper/breeze-asr-25-cffe7cc/","models/whisper/breeze-asr-26-7b99268/","models/whisper/omnilingual-ctc-300m-6abf1ec/","models/speaker/speaker-campplus-f682b51/"].map((dir) => `${BASE}${dir}`);
// 用到時才存的大檔案
const LAZY = [`${BASE}vendor/`, `${BASE}models/`, `${BASE}assets/ort-wasm-`];

// index.html 存成資料夾的網址，瀏覽器開啟的是 /gears/qrcode/ 不是 /gears/qrcode/index.html
const url = (file) => BASE + file.replace(/(^|\/)index\.html$/, "$1");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map(url))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("gears-") && ![CACHE, RUNTIME, MODELS].includes(key)).map((key) => caches.delete(key))))
      // 沒下載過模型就不建立這個快取
      .then(async () => {
        if (!(await caches.has(MODELS))) return;
        const cache = await caches.open(MODELS);
        for (const request of await cache.keys()) {
          if (!MODEL_DIRS.some((dir) => new URL(request.url).pathname.startsWith(dir))) await cache.delete(request);
        }
      })
      .then(() => self.clients.claim()),
  );
});

// 讀者在畫面上按「重新載入」時才換成新版本，避免同一個分頁混用新舊程式
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const target = new URL(request.url);
  if (request.method !== "GET" || target.origin !== location.origin || !target.pathname.startsWith(BASE)) return;
  event.respondWith(respond(request, target));
});

async function respond(request, target) {
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
  const cached = (await caches.match(request, { ...options, cacheName: CACHE })) ?? (await caches.match(request, { ...options, cacheName: RUNTIME }));
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && LAZY.some((prefix) => target.pathname.startsWith(prefix))) {
      const copy = response.clone();
      caches.open(RUNTIME).then((cache) => cache.put(request, copy));
    }
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

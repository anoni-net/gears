// 檔案工作台的 service worker：讓工作台第一次開啟之後，沒有網路也能使用。
// 建置時由 vite.config.ts 的 serviceWorker() 填入版本與檔案清單，輸出成 /gears/sw.js。
//
// 只存工作台自己的檔案（頁面、程式、圖示、165 清單），讀者放進暫存區的檔案從來不經過
// 這裡，也不會被寫進任何快取。人臉與文字辨識的模型很大，用到時才存。

const VERSION = "a6b17a5b706b7405";
const FILES = ["404.html","age-keygen/index.html","assets/AgeEditors-CF2KcvZv.js","assets/AgeKeyFields-hy5lFTZA.js","assets/BlendEditor-C2ofysL1.js","assets/DocCheckEditor-9hAYc9P5.js","assets/EmailTool-hp0O1Cj6.js","assets/HeicConvert-Cv-DI4nh.js","assets/KeygenTool-CWjGoGmg.js","assets/LlmBench-Du5x6Vop.js","assets/NearbyTool-CrwSdBxR.js","assets/PassphraseTool-Dwa1O0Hy.js","assets/PdfPagesEditor-DUuqyjSC.js","assets/PrintDotsEditor-4jZT2xZ5.js","assets/QrReadTool-DRmk7voB.js","assets/QrTool-CzY35TOW.js","assets/RedactEditor-fsFFKE3b.js","assets/RemoteTool-BX7WvFWq.js","assets/SoftwareVerifyTool-CnYBG5QZ.js","assets/TextCryptTool-_uC2Dgkh.js","assets/TranscribeEditor-CPSkMtyF.js","assets/UrlCheckTool-DpHSN6Y4.js","assets/VerifyTool-DlUpxwAz.js","assets/VideoFramesEditor-DT0V92WR.js","assets/WritingStyleTool-DAT6njaz.js","assets/age-9fcFk4ob.js","assets/analytics-SdKZslVx.js","assets/asian-diceware-7776-B6etXB3N.js","assets/bytes-1yWCtDTG.js","assets/c2pa-DJ5N1zkQ.txt","assets/c2pa-check-DCfPM-gq.js","assets/cn2t-Dj0Mm1HJ.js","assets/dist-WnVDJtZt.js","assets/doc-check-DZdSgcEl.js","assets/ed25519-DiHXVcG_.js","assets/es-D35yLQnx.js","assets/files-Cg-D6OMy.js","assets/gpki-cas-Bq0Hrcwj.js","assets/grca-roots-D3zAYHIZ.js","assets/hash-CH-Ksndj.js","assets/heif-wasm-CMmV8uau.js","assets/index-BSdy59go.js","assets/index-Cqgq1srN.css","assets/index.es--_y-R7H6.js","assets/index.es-CecT58Cf.js","assets/interim-allowed-DwL_dhbj.js","assets/interim-anchors-BlsMuRBV.js","assets/interim-store-BMPDeKMl.js","assets/jsQR-BFC9zyzC.js","assets/jsxRuntime-CMqWEpiy.js","assets/keep-exif-zYVI3bKe.js","assets/libheif-BfiPCEgt.wasm","assets/libheif-CgtyKh8t.txt","assets/llm-bench.worker-Dq0lkJP3.js","assets/material-design-icons-DdzlwXnB.txt","assets/official-svq0aKU4.js","assets/official-tsa-Btn_EhX3.js","assets/openpgp-DqDRSIyz.txt","assets/openpgp-rCAS-0gw.js","assets/ort.wasm.bundle.min-DfT_4_w9.js","assets/pdf-compare-BetxHS_Y.js","assets/pdf-lib-C4A6Ah2f.txt","assets/pdf-lib-D6N-uaYE.js","assets/pdf-pages-DLNu8Ty4.js","assets/pdf-pages-j_yl5y7q.js","assets/pdf-signature-check-BnQl-hxb.js","assets/pdf-text-DhMsYP8J.js","assets/pdf.worker.min-CjEcRF4W.mjs","assets/pdfjs-hoTZjcxU.txt","assets/pii-DLz-_Y6w.js","assets/pkijs-BcXeo8-d.txt","assets/preload-helper-BLdHbfdN.js","assets/qrcode-HaoirK2J.js","assets/reader-DltecsD8.js","assets/redact-detect-C7Y75WLy.js","assets/redact-detect-DLPhHhUm.txt","assets/rolldown-runtime-BCiCTKAo.js","assets/save-CuDUW4yv.js","assets/scam-list-loader-BBOlFOwS.js","assets/sherpa.worker-CWWrtHTp.js","assets/speaker-embed-R9oPaGJR.js","assets/tesseract-BoiZRbaI.js","assets/tool-DnIUiV8R.js","assets/transcribe-BTJ8WMXQ.txt","assets/transcribe.worker-BPO3Bo3L.js","assets/transfer-ui-2bcd7qCK.js","assets/transformers.web-B0nuulBJ.js","assets/transformers.web-yma8JMi5.js","assets/tray-preset-Cu1y-swj.js","assets/writing-style-J-uXbiKu.js","assets/zip-BPA6ve1j.js","assets/zxing-DHWynh-k.txt","assets/zxing_reader-Bb9Mx2Pu.wasm","blend/index.html","data/165.txt","decrypt/index.html","doc-check/index.html","email-check/index.html","en/age-keygen/index.html","en/blend/index.html","en/decrypt/index.html","en/doc-check/index.html","en/email-check/index.html","en/encrypt/index.html","en/feedback/index.html","en/heic-to-jpeg/index.html","en/index.html","en/licenses/index.html","en/llm-bench/index.html","en/nearby/index.html","en/passphrase/index.html","en/pdf-pages/index.html","en/print-dots/index.html","en/qr-read/index.html","en/qrcode/index.html","en/redact/index.html","en/remote-server/index.html","en/remote/index.html","en/samples/index.html","en/software-verify/index.html","en/strip-metadata/index.html","en/text-crypt/index.html","en/transcribe/index.html","en/url-check/index.html","en/verify/index.html","en/video-frames/index.html","en/writing-style/index.html","encrypt/index.html","favicon.svg","feedback/index.html","heic-to-jpeg/index.html","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","licenses/index.html","llm-bench/index.html","logo-wordmark-tonal.svg","logo-wordmark-white.svg","manifest.webmanifest","nearby/index.html","passphrase/index.html","pdf-pages/index.html","print-dots/index.html","qr-read/index.html","qrcode/index.html","redact/index.html","remote-server/index.html","remote/index.html","samples/index.html","samples/qr/bitcoin.png","samples/qr/boarding-aztec.png","samples/qr/boarding-pdf417.png","samples/qr/bridge.png","samples/qr/contact.png","samples/qr/event.png","samples/qr/invoice-barcode.png","samples/qr/invoice-left.png","samples/qr/invoice-right.png","samples/qr/isbn.png","samples/qr/otp.png","samples/qr/passkey.png","samples/qr/product.png","samples/qr/promptpay-bad.png","samples/qr/promptpay.png","samples/qr/shadowsocks.png","samples/qr/signal.png","samples/qr/sms.png","samples/qr/twpay.png","samples/qr/url.png","samples/qr/wifi.png","samples/qr/wireguard.png","sitemap.xml","software-verify/index.html","strip-metadata/index.html","text-crypt/index.html","transcribe/index.html","url-check/index.html","verify/index.html","video-frames/index.html","writing-style/index.html","zh-cn/age-keygen/index.html","zh-cn/blend/index.html","zh-cn/decrypt/index.html","zh-cn/doc-check/index.html","zh-cn/email-check/index.html","zh-cn/encrypt/index.html","zh-cn/feedback/index.html","zh-cn/heic-to-jpeg/index.html","zh-cn/index.html","zh-cn/licenses/index.html","zh-cn/llm-bench/index.html","zh-cn/nearby/index.html","zh-cn/passphrase/index.html","zh-cn/pdf-pages/index.html","zh-cn/print-dots/index.html","zh-cn/qr-read/index.html","zh-cn/qrcode/index.html","zh-cn/redact/index.html","zh-cn/remote-server/index.html","zh-cn/remote/index.html","zh-cn/samples/index.html","zh-cn/software-verify/index.html","zh-cn/strip-metadata/index.html","zh-cn/text-crypt/index.html","zh-cn/transcribe/index.html","zh-cn/url-check/index.html","zh-cn/verify/index.html","zh-cn/video-frames/index.html","zh-cn/writing-style/index.html"];
const BASE = "/";
const CACHE = `gears-${VERSION}`;
const RUNTIME = `gears-${VERSION}-runtime`;
// 逐字稿的 Whisper 模型（80 到 250 MB）與分辨說話者的 CAM++（28 MB）另外存一個不隨版本清掉的快取，換新版本時不必重新下載。
// 網址帶著模型的版本，清單以外的（舊版本的模型）在新版本接手時刪掉
const MODELS = "gears-models";
const MODEL_DIRS = ["models/whisper/whisper-small-36050c4/","models/whisper/whisper-base-1846881/","models/whisper/whisper-large-v3-turbo-360ebcd/","models/whisper/th-distill-small-14d3037/","models/whisper/breeze-asr-25-cffe7cc/","models/whisper/breeze-asr-26-7b99268/","models/whisper/omnilingual-ctc-300m-6abf1ec/","models/speaker/speaker-campplus-f682b51/"].map((dir) => `${BASE}${dir}`);
// 用到時才存的大檔案
const LAZY = [`${BASE}vendor/`, `${BASE}models/`, `${BASE}assets/ort-wasm-`, `${BASE}assets/c2pa_bg-`];

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

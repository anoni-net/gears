import { defaultThreads } from "../tools/transcribe/threads.ts";

// 逐字稿預設同時使用的 CPU 核心數（判斷見 src/tools/transcribe/threads.ts），逐字稿與裝置量測共用，
// 量出來的數字才是讀者實際會遇到的設定。多執行緒要頁面在 cross-origin isolation 底下，沒有時只能用 1 個
export const ISOLATED = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
export const FIREFOX = /Firefox\//.test(navigator.userAgent);
export const DEFAULT_THREADS = ISOLATED
  ? defaultThreads({
      firefox: FIREFOX,
      reported: navigator.hardwareConcurrency || 0,
      brave: "brave" in navigator,
      // Safari 的 UA 有 Safari 沒有 Chrome；iPad 的 Safari 偽裝成 Mac，用觸控點數分辨
      safari: /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent),
      mobileApple: /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    })
  : 1;

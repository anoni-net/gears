// 建置時寫進來的版本（vite.config.ts 的 define，算法見 src/core/version.ts）。
// 讀者回報問題時照頁尾抄下來，查證紀錄也記下

export const VERSION = __GEARS_VERSION__;
export const COMMIT = __GEARS_COMMIT__;
export const COMMIT_URL = `https://github.com/anoni-net/gears/commit/${COMMIT}`;

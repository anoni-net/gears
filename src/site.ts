// 建置目標：clearnet 的 anoni.net/gears/，或 onion 的 gears.<onion>（網站放在子網域的根目錄）。
// `GEARS_TARGET=onion npm run build` 建置 onion 版，vite.config.ts 用 __GEARS_ONION__ 告訴程式。
// vite.config.ts 在 Node 裡也會匯入這個檔案，那時沒有 __GEARS_ONION__，所以用 typeof 判斷。

export const ONION_HOST = "anoninetru5tflukgfaehun7q6khowgmymcff3gtk5oyesqazhmfxtyd.onion";

export const IS_ONION = typeof __GEARS_ONION__ !== "undefined" && __GEARS_ONION__;

// 頁尾連回社群首頁。onion 版連到 onion 的首頁，讀者不必離開 Tor 網路
export const COMMUNITY_URL = IS_ONION ? `http://${ONION_HOST}/` : "https://anoni.net/";

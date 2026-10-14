import { defineConfig, type Plugin } from "vite";

// 頁面能連線的對象寫死在 CSP 裡。就算某個相依套件被植入程式，檔案也送不出去，
// 讀者也能從頁面原始碼自行確認。connect-src 只有自己的網域，之後的伺服器處理與
// 統計都要在這裡明列。只在正式建置加上，開發伺服器需要的內嵌腳本會被它擋掉。
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function csp(): Plugin {
  return {
    name: "gears-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<!-- csp -->", `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  base: "/gears/",
  plugins: [csp()],
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    target: "es2022",
    // 小檔案也輸出成獨立檔案，不內嵌成 data: 網址，CSP 才看得到每一個資源
    assetsInlineLimit: 0,
  },
});

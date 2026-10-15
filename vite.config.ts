import { defineConfig, type Plugin } from "vite";
import { zhTW } from "./src/i18n/zh-TW.ts";
import { toolIds } from "./src/tools/index.ts";

// 頁面能連線的對象寫死在 CSP 裡。就算某個相依套件被植入程式，檔案也送不出去，
// 讀者也能從頁面原始碼自行確認。connect-src 只有自己的網域，之後的伺服器處理與
// 統計都要在這裡明列。只在正式建置加上，開發伺服器需要的內嵌腳本會被它擋掉。
const CSP = [
  "default-src 'none'",
  // WebAssembly（HEIC 的解碼器 libheif）需要 wasm-unsafe-eval，它只允許編譯 WebAssembly，
  // 不會開放 JavaScript 的 eval
  "script-src 'self' 'wasm-unsafe-eval'",
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

// 每個工具一份 HTML（/gears/qrcode/index.html），標題與描述各自不同，可以被搜尋到，
// 也不需要伺服器的轉址設定。內容跟首頁相同，打開之後由 src/router.ts 判斷要顯示
// 哪個工具。
const meta = zhTW as Record<string, string>;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function withMeta(html: string, title: string, description: string) {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${escape(description)}"`);
}

function toolPages(): Plugin {
  return {
    name: "gears-tool-pages",
    enforce: "post",
    apply: "build",
    transformIndexHtml(html) {
      return withMeta(html, meta["meta.home.title"]!, meta["meta.home.description"]!);
    },
    generateBundle(_, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") throw new Error("index.html not found");
      for (const id of toolIds) {
        this.emitFile({
          type: "asset",
          fileName: `${id}/index.html`,
          source: withMeta(String(index.source), meta[`meta.${id}.title`]!, meta[`meta.${id}.description`]!),
        });
      }
    },
  };
}

export default defineConfig({
  base: "/gears/",
  plugins: [csp(), toolPages()],
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    target: "es2022",
    // 小檔案也輸出成獨立檔案，不內嵌成 data: 網址，CSP 才看得到每一個資源
    assetsInlineLimit: 0,
  },
});

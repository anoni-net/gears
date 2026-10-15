import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
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
  // 音訊與影片的預覽：只播放暫存區裡的檔案（blob:），不從任何網址載入
  "media-src blob:",
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

// 離線使用：建置完成後列出 dist/ 裡的檔案，產生 /gears/sw.js（範本在 src/sw/sw-template.js）。
// vendor/ 底下的辨識模型很大，不預先存，用到時才存。版本是所有檔案內容的雜湊，
// 任何檔案改了（包括每月更新的 165 清單），瀏覽器就會裝新的 service worker
function serviceWorker(base: string): Plugin {
  return {
    name: "gears-service-worker",
    apply: "build",
    closeBundle() {
      const dist = join(import.meta.dirname, "dist");
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else files.push(relative(dist, path).split("\\").join("/"));
        }
      };
      walk(dist);
      const precache = files.filter((f) => !f.startsWith("vendor/") && !f.startsWith("models/") && f !== "sw.js" && !f.endsWith(".map")).sort();
      const hash = createHash("sha256");
      for (const f of precache) hash.update(f).update(readFileSync(join(dist, f)));
      const template = readFileSync(join(import.meta.dirname, "src/sw/sw-template.js"), "utf8");
      writeFileSync(
        join(dist, "sw.js"),
        template
          .replace("__VERSION__", hash.digest("hex").slice(0, 16))
          .replace("__FILES__", JSON.stringify(precache))
          .replace("__BASE__", base),
      );
    },
  };
}

export default defineConfig({
  base: "/gears/",
  plugins: [csp(), toolPages(), serviceWorker("/gears/")],
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    target: "es2022",
    // 小檔案也輸出成獨立檔案，不內嵌成 data: 網址，CSP 才看得到每一個資源
    assetsInlineLimit: 0,
  },
});

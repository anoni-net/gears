import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { LOCALES, messagesOf } from "./src/i18n/index.ts";
import { labIds, pageIds } from "./src/pages.ts";
import { toolIds } from "./src/tools/index.ts";
import benchModels from "./src/tools/llm-bench/models.json" with { type: "json" };
import whisper from "./src/tools/transcribe/models.json" with { type: "json" };
import { ASSETS_MODELS } from "./src/tools/transcribe/remote.ts";
import speakerModel from "./src/tools/transcribe/speaker-model.json" with { type: "json" };
import { ANALYTICS_ENDPOINT } from "./src/ui/analytics-endpoint.ts";
import ogImages from "./src/og-images.json" with { type: "json" };
import { ONION_HOST } from "./src/site.ts";
import { calver } from "./src/core/version.ts";

// onion 版（GEARS_TARGET=onion）：給 gears.<onion> 的建置，網站放在子網域的根目錄，輸出到 dist-onion/。
// 頁面只連自己的網域：不送使用統計，社群轉檔的模型也由同一個 onion 網站提供（src/site.ts）。
// 逐字稿的大模型仍然在讀者選擇之後從 Hugging Face 下載，經過 Tor 網路
const ONION = process.env.GEARS_TARGET === "onion";
const BASE = ONION ? "/" : "/gears/";
const OUT_DIR = ONION ? "dist-onion" : "dist";

// 頁面能連線的對象寫死在 CSP 裡。就算某個相依套件被植入程式，檔案也送不出去，
// 讀者也能從頁面原始碼自行確認。connect-src 只有自己的網域，之後的伺服器處理與
// 統計都要在這裡明列。只在正式建置加上，開發伺服器需要的內嵌腳本會被它擋掉。
const policy = (connect: string) => [
  "default-src 'none'",
  // WebAssembly（HEIC 的解碼器 libheif）需要 wasm-unsafe-eval，它只允許編譯 WebAssembly，
  // 不會開放 JavaScript 的 eval
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  // 音訊與影片的預覽：只播放暫存區裡的檔案（blob:），不從任何網址載入
  "media-src blob:",
  `connect-src ${connect}`,
  "worker-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// 頁面的 meta 標籤只允許自己的網域，加上使用統計的送出網址（社群自架的 Umami，見 src/ui/analytics.ts）
const CSP = policy(ONION ? "'self'" : `'self' ${ANALYTICS_ENDPOINT}`);

// 伺服器用標頭送的 CSP 多開兩個地方，給逐字稿的 Worker 下載別的網域的模型（見
// src/tools/transcribe/remote.ts）。Worker 只吃標頭的 CSP。頁面同時有標頭與 meta 標籤時兩者
// 都要符合，頁面本身仍然只能連自己的網域。
// - Hugging Face（讀者選擇之後才連）：huggingface.co 限定在每個模型的下載路徑，不開放上傳用的
//   API，下載會轉址到 *.hf.co 的 CDN（轉址之後 CSP 不比對路徑，只能寫主機）。語言模型速度量測的
//   實驗頁（src/tools/llm-bench/models.json）也一樣，每個模型鎖定 commit
// - assets.anoni.net：社群轉檔的模型，限定在模型的目錄（onion 版由自己的網域提供）
const HEADER_CSP = policy(
  [
    "'self'",
    ...(ONION ? [] : [ANALYTICS_ENDPOINT]),
    ...Object.values(whisper)
      .filter((m) => m.host === "hf")
      .map((m) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/`),
    ...Object.values(benchModels).map((m) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/`),
    "https://*.hf.co",
    ...(ONION ? [] : [ASSETS_MODELS]),
  ].join(" "),
);

function csp(): Plugin {
  return {
    name: "gears-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<!-- csp -->", `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// 每個語系、每個工具一份 HTML（/gears/qrcode/、/gears/en/qrcode/），標題、描述與 lang 各自
// 不同，可以被搜尋到，也不需要伺服器的轉址設定。內容跟首頁相同，打開之後由 src/router.ts
// 判斷語系與要顯示哪個工具。
const SITE = ONION ? `http://gears.${ONION_HOST}/` : "https://anoni.net/gears/";
const COMMUNITY = ONION ? `http://${ONION_HOST}/` : "https://anoni.net/";
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

type Locale = (typeof LOCALES)[number];
const pageUrl = (locale: Locale, id: string) => `${SITE}${locale.prefix}${id ? `${id}/` : ""}`;
// Open Graph 的語系寫法
const OG_LOCALE: Record<string, string> = { "zh-TW": "zh_TW", "zh-CN": "zh_CN", en: "en_US" };

// 搜尋引擎與分享預覽用的標籤：canonical、各語系的 hreflang（x-default 指向正體中文）、Open Graph 與
// Twitter 的卡片（圖片由 scripts/make-og.mjs 產生、放在 assets.anoni.net，網址在 src/og-images.json），
// 首頁另外加上 WebApplication 的結構化資料
function seoTags(locale: Locale, id: string, title: string, description: string, meta: Record<string, string>) {
  const url = pageUrl(locale, id);
  const image = (ogImages as Record<string, string>)[locale.id]!;
  const tags = [
    `<link rel="canonical" href="${url}" />`,
    ...LOCALES.map((l) => `<link rel="alternate" hreflang="${l.lang}" href="${pageUrl(l, id)}" />`),
    `<link rel="alternate" hreflang="x-default" href="${pageUrl(LOCALES[0], id)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="anoni.net Gears" />`,
    `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[locale.id]}" />`,
    ...LOCALES.filter((l) => l.id !== locale.id).map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l.id]}" />`),
    // 分享卡片的圖片放在 clearnet 的 assets.anoni.net，onion 版不放
    ...(ONION
      ? []
      : [
          `<meta property="og:image" content="${image}" />`,
          `<meta property="og:image:width" content="1200" />`,
          `<meta property="og:image:height" content="630" />`,
          `<meta property="og:image:alt" content="${escape(`${meta["app.title"]} Gears`)}" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
        ]),
  ];
  if (labIds.includes(id)) tags.push(`<meta name="robots" content="noindex" />`);
  if (!id) {
    // 不是程式，瀏覽器不會執行，CSP 不必放寬。< 換成 \u003c，內容裡的 </script> 才不會提早結束標籤
    const data = {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: title,
      alternateName: "Gears",
      url,
      description,
      inLanguage: locale.lang,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "anoni.net", url: COMMUNITY },
    };
    tags.push(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
  }
  return tags.join("\n    ");
}

// 每個語系、每個頁面的網址，sitemap.xml 用
function sitemap(ids: string[]) {
  const entries = ids.flatMap((id) =>
    LOCALES.map((locale) => {
      const links = [...LOCALES.map((l) => [l.lang, pageUrl(l, id)]), ["x-default", pageUrl(LOCALES[0], id)]]
        .map(([lang, href]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}" />`)
        .join("\n");
      return `  <url>\n    <loc>${pageUrl(locale, id)}</loc>\n${links}\n  </url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}

function localized(html: string, locale: Locale, id: string) {
  const meta = messagesOf(locale.id) as Record<string, string>;
  const title = meta[id ? `meta.${id}.title` : "meta.home.title"]!;
  const description = meta[id ? `meta.${id}.description` : "meta.home.description"]!;
  return html
    .replace(/<html lang="[^"]*">/, `<html lang="${locale.lang}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>\n    ${seoTags(locale, id, title, description, meta)}`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${escape(description)}"`)
    .replace(/<noscript>[^<]*<\/noscript>/, `<noscript>${escape(meta["app.noscript"]!)}</noscript>`);
}

function toolPages(): Plugin {
  let template = "";
  return {
    name: "gears-tool-pages",
    enforce: "post",
    apply: "build",
    transformIndexHtml(html) {
      template = html;
      return localized(html, LOCALES[0], "");
    },
    generateBundle() {
      if (!template) throw new Error("index.html not found");
      for (const locale of LOCALES) {
        for (const id of ["", ...toolIds, ...pageIds]) {
          if (!locale.prefix && !id) continue; // 正體中文的首頁就是 index.html
          this.emitFile({ type: "asset", fileName: `${locale.prefix}${id ? `${id}/` : ""}index.html`, source: localized(template, locale, id) });
        }
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap(["", ...toolIds, ...pageIds.filter((id) => !labIds.includes(id))]) });
    },
  };
}

// 離線使用：建置完成後列出輸出目錄裡的檔案，產生 /gears/sw.js（範本在 src/sw/sw-template.js）。
// vendor/、models/ 底下的辨識模型與 onnxruntime 的 WebAssembly（約 14 MB）很大，不預先存，
// 用到時才存（src/sw/sw-template.js 的 LAZY）。版本是所有檔案內容的雜湊，
// 任何檔案改了（包括每月更新的 165 清單），瀏覽器就會裝新的 service worker
function serviceWorker(base: string): Plugin {
  return {
    name: "gears-service-worker",
    apply: "build",
    closeBundle() {
      const dist = join(import.meta.dirname, OUT_DIR);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else files.push(relative(dist, path).split("\\").join("/"));
        }
      };
      walk(dist);
      const lazy = (f: string) => f.startsWith("vendor/") || f.startsWith("models/") || /^assets\/ort-wasm-/.test(f);
      const precache = files.filter((f) => !lazy(f) && f !== "sw.js" && !f.endsWith(".map")).sort();
      const hash = createHash("sha256");
      for (const f of precache) hash.update(f).update(readFileSync(join(dist, f)));
      const template = readFileSync(join(import.meta.dirname, "src/sw/sw-template.js"), "utf8");
      writeFileSync(
        join(dist, "sw.js"),
        template
          .replace("__VERSION__", hash.digest("hex").slice(0, 16))
          .replace("__FILES__", JSON.stringify(precache))
          .replace("__MODEL_DIRS__", JSON.stringify([...Object.values(whisper).map((m) => `models/whisper/${m.dir}/`), `models/speaker/${speakerModel.dir}/`]))
          .replace("__BASE__", base),
      );
    },
  };
}

// 部署時 nginx 送的標頭（tools/nginx-gears.conf 引用），跟預覽伺服器送的是同一組。CSP 會跟著
// 大模型的 commit 變，所以每次建置都產生一份，m6 的拉取腳本（tools/m6-pull.sh）比對有變才換上、
// 檢查設定之後 reload。快取標頭的對照在 tools/nginx-gears.conf 的 map $gears_cache_control
// onion 版另外一份（nginx-headers-onion.conf），快取的對照是 $gears_onion_cache_control
function nginxHeaders(): Plugin {
  return {
    name: "gears-nginx-headers",
    apply: "build",
    closeBundle() {
      const lines = [
        "# 由 anoni-net/gears 的建置產生（vite.config.ts 的 nginxHeaders），不要手改",
        `add_header Content-Security-Policy "${HEADER_CSP}" always;`,
        ...Object.entries(isolation).map(([name, value]) => `add_header ${name} "${value}" always;`),
        'add_header X-Content-Type-Options "nosniff" always;',
        `add_header Cache-Control ${ONION ? "$gears_onion_cache_control" : "$gears_cache_control"} always;`,
      ];
      mkdirSync(join(import.meta.dirname, "deploy"), { recursive: true });
      writeFileSync(join(import.meta.dirname, ONION ? "deploy/nginx-headers-onion.conf" : "deploy/nginx-headers.conf"), `${lines.join("\n")}\n`);
    },
  };
}

// 建置時的 commit，偵錯輸出用來確認讀者跑的是哪一版。不在 git 裡建置時是 unknown
function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

const commit = () => git("rev-parse --short HEAD") ?? "unknown";

// 版本號是 commit 的日期（src/core/version.ts）。沒有 git 時用建置當下的日期
const version = () => calver(Number(git("log -1 --format=%ct") ?? Date.now() / 1000));

// cross-origin isolation：逐字稿的 WebAssembly 要用多執行緒，頁面要在這兩個標頭底下。
// 工作台所有的資源都來自自己的網域，加上之後不影響其他功能。部署時 nginx 也要送一樣的標頭
const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  base: BASE,
  server: { headers: isolation },
  // 預覽伺服器另外用標頭送 CSP：Web Worker 不受頁面 meta 標籤的 CSP 約束，要靠標頭。
  // 部署時 nginx 也要送一樣的 CSP 標頭（開發伺服器需要內嵌腳本，不加）
  // anoni.net：使用統計的測試把這個主機名指到預覽伺服器（tests/e2e/analytics.spec.ts）
  preview: { headers: { ...isolation, "Content-Security-Policy": HEADER_CSP }, allowedHosts: ["anoni.net"] },
  // Worker 裡用 import() 延後載入 Transformers.js 與 OpenCC，要輸出成 ES 模組
  worker: { format: "es" },
  define: { __GEARS_COMMIT__: JSON.stringify(commit()), __GEARS_VERSION__: JSON.stringify(version()), __GEARS_ONION__: JSON.stringify(ONION) },
  plugins: [csp(), toolPages(), serviceWorker(BASE), nginxHeaders()],
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  build: {
    target: "es2022",
    outDir: OUT_DIR,
    // 小檔案也輸出成獨立檔案，不內嵌成 data: 網址，CSP 才看得到每一個資源
    assetsInlineLimit: 0,
  },
});

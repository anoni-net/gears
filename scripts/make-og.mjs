// 產生分享到社群與聊天軟體時的預覽卡片（og:image），每個語系一張，1200×630 的 PNG。
// 圖片不進 repo，跟社群其他網站一樣放在 assets.anoni.net：
//
//   node scripts/make-og.mjs <輸出目錄>
//   rsync -av <輸出目錄>/ m6_tailscale:/srv/images-anoni-net/gears/og/
//
// 檔名帶內容雜湊（gears-<語系>-<雜湊>.png），換圖時網址跟著換，不會拿到 Cloudflare 的舊快取。
// 執行完把印出的網址填進 src/og-images.json，頁面的 og:image 讀那裡（vite.config.ts）。
// 用本機的 Noto Sans CJK 畫中文字，沒有安裝的話字會變成方框。
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const out = process.argv[2];
if (!out) throw new Error("用法：node scripts/make-og.mjs <輸出目錄>");
const root = new URL("..", import.meta.url).pathname;
const wordmark = readFileSync(join(root, "public/logo-wordmark-tonal.svg"), "utf8");

const CARDS = {
  "zh-TW": {
    lang: "zh-Hant-TW",
    font: '"Noto Sans CJK TC", "Noto Sans TC"',
    name: "檔案工作台",
    line: "清除中繼資料、遮蔽個資、加密檔案，也替收到的檔案整理查證線索。全部在你的瀏覽器裡處理，檔案不上傳。",
  },
  "zh-CN": {
    lang: "zh-Hans",
    font: '"Noto Sans CJK SC", "Noto Sans SC"',
    name: "文件工作台",
    line: "清除元数据、遮蔽个资、加密文件，也替收到的文件整理查证线索。全部在你的浏览器里处理，文件不上传。",
  },
  en: {
    lang: "en",
    font: '"Noto Sans", "Noto Sans CJK TC"',
    name: "File Workbench",
    line: "Strip metadata, redact and encrypt files, and lay out leads to verify in the files you receive. Everything runs in your browser and nothing is uploaded.",
  },
};

const page = (card) => `<!doctype html>
<html lang="${card.lang}"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #e0f4ff; color: #0f2a35; font-family: ${card.font}, sans-serif;
    display: flex; flex-direction: column; padding: 72px 88px; border-bottom: 16px solid #006d99; }
  .mark svg { height: 64px; width: auto; display: block; }
  h1 { margin-top: 52px; font-size: 96px; font-weight: 700; letter-spacing: 0.04em; display: flex; align-items: flex-start; gap: 24px; }
  .badge { margin-top: 14px; font-size: 30px; font-weight: 700; letter-spacing: 0.04em; color: #006d99;
    border: 3px solid #006d99; border-radius: 999px; padding: 2px 18px; font-family: "Noto Sans", sans-serif; }
  p { margin-top: 28px; font-size: 32px; line-height: 1.5; color: #35505c; max-width: 1024px; }
  .url { margin-top: auto; padding-top: 24px; font-size: 28px; color: #006d99; font-family: "Noto Sans", sans-serif; }
</style></head><body>
  <div class="mark">${wordmark}</div>
  <h1>${card.name}<span class="badge">Gears</span></h1>
  <p>${card.line}</p>
  <div class="url">anoni.net/gears</div>
</body></html>`;

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const urls = {};
for (const [locale, card] of Object.entries(CARDS)) {
  await tab.setContent(page(card));
  await tab.evaluate(() => document.fonts.ready);
  const png = await tab.screenshot({ type: "png" });
  const name = `gears-${locale.toLowerCase()}-${createHash("sha256").update(png).digest("hex").slice(0, 8)}.png`;
  writeFileSync(join(out, name), png);
  urls[locale] = `https://assets.anoni.net/gears/og/${name}`;
}
await browser.close();
console.log(JSON.stringify(urls, null, 2));

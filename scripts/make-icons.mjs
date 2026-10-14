// 用 public/favicon.svg（anoni.net 的 logo）產生主畫面用的 PNG 圖示。
// iPhone 的「加入主畫面」只吃 PNG，Android 與 Brave 的安裝讀 manifest 裡的 192 與 512。
// 底色是頁首的 cyan-50，logo 佔中間六成，Android 裁成圓形或圓角時也不會被切到。
//
//   node scripts/make-icons.mjs
//
// 產生的圖檔進版控，logo 沒有改的話不必重新產生。

import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const svg = await readFile("public/favicon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#e0f4ff;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${Math.round(size * 0.6)}px;height:${Math.round(size * 0.6)}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: false });
  console.log(`public/icons/${name}`);
}
await browser.close();

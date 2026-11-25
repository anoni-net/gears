#!/usr/bin/env node
// 「為什麼做 Gears」（src/ui/WhyPage.tsx）同類工具名稱前面的圖示。從各專案自己的 repo 或網站下載，
// GitHub 上的檔案鎖定 commit，用瀏覽器畫成 64 × 64 的 PNG，寫進 public/peers/，進版控。
// 頁面只從自己的網域載入，不連到各專案的網站（CSP 的 img-src 只有 'self'）。
// SVG 也畫成 PNG：第三方的 SVG 從自己的網域送出，直接打開時裡面的程式會執行。
//
// 來源、授權與商標的說明寫在 licenses/peer-logos.txt，改了清單（scripts/peer-logos.json）要一起改。
//
//   node scripts/make-peer-logos.mjs
//
// 只有圖示加文字的橫式 logo 時，crop 指定要留下的範圍（佔寬度的比例，高度整個留著），
// 裁完再拿掉四周透明的邊。

import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

// 清單在 scripts/peer-logos.json：測試也讀它（tests/unit/why-logos.spec.ts），放在 JSON 才有型別。
// GitHub 上的檔案網址寫成 raw.githubusercontent.com/<repo>/<commit>/<路徑>，鎖定 commit
const { size: SIZE, logos: LOGOS } = JSON.parse(await readFile(join(import.meta.dirname, "peer-logos.json"), "utf8"));

const MIME = { png: "image/png", svg: "image/svg+xml", ico: "image/x-icon" };

async function main() {
  const out = join(import.meta.dirname, "../public/peers");
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const logo of LOGOS) {
    const res = await fetch(logo.url);
    if (!res.ok) throw new Error(`${logo.id}：${res.status} ${logo.url}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const ext = logo.url.split(".").pop().split("?")[0];
    const src = `data:${MIME[ext]};base64,${bytes.toString("base64")}`;
    // 在空白頁的 canvas 上畫：來源是 data: 網址，canvas 不會被當成跨來源而讀不回來
    const dataUrl = await page.evaluate(
      async ({ src, crop, size }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        // SVG 沒有固定的像素大小時，先畫成高 512 的圖
        const scale = img.naturalWidth && img.naturalHeight < 256 && src.startsWith("data:image/svg") ? 512 / img.naturalHeight : 1;
        const w = Math.round((img.naturalWidth || 512) * scale);
        const h = Math.round((img.naturalHeight || 512) * scale);
        const full = document.createElement("canvas");
        full.width = w;
        full.height = h;
        full.getContext("2d").drawImage(img, 0, 0, w, h);
        let [x0, x1] = crop ? [Math.round(crop[0] * w), Math.round(crop[1] * w)] : [0, w];
        // 拿掉四周透明的邊
        const data = full.getContext("2d").getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++)
          for (let x = x0; x < x1; x++)
            if (data[(y * w + x) * 4 + 3] > 8) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
        if (maxX < 0) throw new Error("空白的圖");
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        const out = document.createElement("canvas");
        out.width = size;
        out.height = size;
        const ctx = out.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        const k = size / Math.max(cw, ch);
        ctx.drawImage(full, minX, minY, cw, ch, (size - cw * k) / 2, (size - ch * k) / 2, cw * k, ch * k);
        return out.toDataURL("image/png");
      },
      { src, crop: logo.crop ?? null, size: SIZE },
    );
    const png = Buffer.from(dataUrl.split(",")[1], "base64");
    await writeFile(join(out, `${logo.id}.png`), png);
    const sha = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    console.log(`${logo.id}.png ${png.length} bytes（原檔 sha256 ${sha}…）`);
  }
  await browser.close();
}

await main();

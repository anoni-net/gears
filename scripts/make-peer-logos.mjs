#!/usr/bin/env node
// 「為什麼做 Gears」（src/ui/WhyPage.tsx）同類工具名稱前面的圖示。從各專案自己的 repo 或網站下載，
// GitHub 上的檔案鎖定 commit，用瀏覽器畫成 64 × 64 的 PNG，寫進 public/peers/，進版控。
// 頁面只從自己的網域載入，不連到各專案的網站（CSP 的 img-src 只有 'self'）。
// SVG 也畫成 PNG：第三方的 SVG 從自己的網域送出，直接打開時裡面的程式會執行。
//
// 來源、授權與商標的說明寫在 licenses/peer-logos.txt，改了這裡的清單要一起改。
//
//   node scripts/make-peer-logos.mjs
//
// 只有圖示加文字的橫式 logo 時，crop 指定要留下的範圍（佔寬度的比例，高度整個留著），
// 裁完再拿掉四周透明的邊。

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const GH = (repo, commit, path) => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;

export const LOGOS = [
  { id: "metadatacleaner", url: "https://dl.flathub.org/media/fr/romainvigier/MetadataCleaner/b6488b7260afea8141f8c0856e297993/icons/128x128/fr.romainvigier.MetadataCleaner.png" },
  { id: "mat2", url: GH("jvoisin/mat2", "5098533876135a7547b7a922ff408d749c29455e", "data/mat2.png") },
  { id: "imagescrubber", url: GH("everestpipkin/image-scrubber", "390b166cfc61326476ed9d6cb376291f87e35c23", "scrubber_logo.png") },
  { id: "dface", url: GH("vframeio/dface", "b9fbf7ffa36f2fe54f9c37d01f5479c0c5ae0151", "public/assets/img/favicon/android-icon-192x192.png") },
  { id: "obscuracam", url: GH("guardianproject/ObscuraCam", "638f156500798616aec0ff2715abd392f683354b", "app/src/main/res/drawable/ic_launcher_ssc.png") },
  { id: "atrain", url: GH("BANDAS-Center/aTrain", "69d087b9e3123e8bb9a0c71a8e2dcac8e93c985b", "logo.png") },
  { id: "noscribe", url: GH("kaixxx/noScribe", "1e146c3bd8a00218fdda3fea090a1c79a62faab3", "img/noScribeLogo.png") },
  { id: "anonymouth", url: GH("psal/anonymouth", "7bd8e24b661f587facf8715a1de345dffde9734e", "src/edu/drexel/psal/resources/graphics/anonymouth_LOGO.png") },
  { id: "onionshare", url: GH("onionshare/onionshare", "17a58b35b508b08414003d1d454d6bbf229e66a5", "cli/onionshare_cli/resources/static/img/logo.png") },
  { id: "pairdrop", url: GH("schlagmichdoch/PairDrop", "1b0c9c9d903c3cfc706df1303dc75c3b54d04c77", "public/images/logo_blue_512x512.png") },
  { id: "wormhole", url: "https://wormhole.app/apple-touch-icon.png" },
  { id: "dangerzone", url: GH("freedomofpress/dangerzone", "f97310cad237d2f96a58df3ab004c241628a39dd", "share/icon.png") },
  { id: "invid", url: GH("AFP-Medialab/verification-plugin", "da8b93a43645bc22a29dbb5e4903f6cb964aba7c", "src/assets/icon-128.png") },
  { id: "c2pa", url: GH("contentauth/verify-site", "a09c33de417c4ed8f6ab4c621f0f802168dc910f", "assets/svg/color/cr-icon-fill.svg") },
  { id: "tella", url: GH("Horizontal-org/Tella-Android-FOSS", "2caf0177f98fe5f1106d04190270a5cda70ae7e1", "fastlane/metadata/android/en-US/images/icon.png") },
  { id: "proofmode", url: GH("guardianproject/proofmode-android", "0ccd61a4e36ac8921545422dee8918b0e05891c3", "app/src/main/ic_launcher-playstore.png") },
  { id: "cyberchef", url: GH("gchq/CyberChef", "44e2433722b44456bfd4cccdb9b986d047d2c2e2", "src/web/static/images/logo/cyberchef.svg") },
  { id: "autoarchiver", url: GH("bellingcat/auto-archiver", "ceef7213eb36539978065dcd49ba162315e98b70", "docs/source/bc.png"), crop: [0, 0.2] },
  { id: "cofacts", url: GH("cofacts/rumors-site", "4d10bbc8550bdce0330925fd318c16d1a5d09af7", "components/AppLayout/images/logo-mobile.svg"), crop: [0, 0.3] },
  { id: "whoscall", url: "https://whoscall.com/favicon.ico" },
  { id: "g0v", url: GH("cofacts/rumors-site", "4d10bbc8550bdce0330925fd318c16d1a5d09af7", "components/ReportPage/images/logos/g0v.svg"), crop: [0.37, 0.64] },
];

export const SIZE = 64;

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

if (import.meta.url === `file://${process.argv[1]}`) await main();

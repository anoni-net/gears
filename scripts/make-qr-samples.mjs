// QR code 與條碼讀取的範例圖片：照 src/tools/qr-read/samples.json 的內容，用 zxing-wasm 的完整版
// （含產生條碼）畫成 PNG，寫到 public/samples/qr/（不進版控，repo 不放圖檔）。
// 建置與開發伺服器啟動前自動執行（package.json 的 prebuild、predev）。網頁只載入讀取的那一半。
//
// 文字一律先轉成位元組再交給 zxing，QR code 寫成位元組模式、不加 ECI，跟產生器
// （qrcode-generator）一樣。電子發票的範例用 Big5，直接給位元組（bytes 欄位是十六進位）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/full";

const require = createRequire(import.meta.url);
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/full/zxing_full.wasm")).buffer } });

const root = new URL("..", import.meta.url).pathname;
const samples = JSON.parse(readFileSync(`${root}src/tools/qr-read/samples.json`, "utf8"));
const out = `${root}public/samples/qr`;
mkdirSync(out, { recursive: true });

for (const s of samples) {
  const input = s.bytes ? Buffer.from(s.bytes, "hex") : new TextEncoder().encode(s.text);
  const linear = !["QRCode", "PDF417", "Aztec", "DataMatrix"].includes(s.format);
  const result = await writeBarcode(new Uint8Array(input), { format: s.format, scale: linear ? 3 : 4, ...(s.format === "QRCode" ? { ecLevel: "M" } : {}) });
  if (result.error || !result.image) throw new Error(`${s.id}: ${result.error}`);
  writeFileSync(`${out}/${s.id}.png`, Buffer.from(await result.image.arrayBuffer()));
}
console.log(`QR code 範例：${samples.length} 張，寫到 public/samples/qr/`);

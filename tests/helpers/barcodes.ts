import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/full";

// 用 zxing-wasm 的完整版（含產生條碼）做測試用的條碼圖片。網頁只載入讀取的那一半
const require = createRequire(import.meta.url);
prepareZXingModule({ overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/full/zxing_full.wasm")).buffer as ArrayBuffer } });

export async function barcodePng(text: string, format: "PDF417" | "Aztec" | "EAN13" | "EAN8" | "Code39" | "Code128" | "DataMatrix"): Promise<Buffer> {
  const result = await writeBarcode(text, { format, scale: 4 });
  if (result.error || !result.image) throw new Error(result.error);
  return Buffer.from(await result.image.arrayBuffer());
}

// 登機證的 BCBP，一個航段、沒有選用欄位。姓名補到 20 碼，其他欄位照規定的長度
export function bcbp(opts: { name: string; pnr: string; from: string; to: string; carrier: string; flight: string; day: number; seat: string; extra?: string }): string {
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const extra = opts.extra ?? "";
  return (
    `M1${pad(opts.name, 20)}E${pad(opts.pnr, 7)}${opts.from}${opts.to}${pad(opts.carrier, 3)}${pad(opts.flight.padStart(4, "0"), 5)}` +
    `${String(opts.day).padStart(3, "0")}Y${opts.seat.padStart(4, "0")}0025 1${extra.length.toString(16).toUpperCase().padStart(2, "0")}${extra}`
  );
}

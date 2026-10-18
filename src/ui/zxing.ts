// 條碼的解碼器 zxing-wasm（zxing-cpp 編譯成 WebAssembly，約 950 KB）。用到時才載入。
//
// zxing-wasm 預設從 jsDelivr 下載 WebAssembly，這裡把 locateFile 換成自己網域的檔案
// （Vite 打包到 assets/，service worker 預先存起來），頁面不連到其他網站。
// 升級前在套件裡搜尋對外的網址，3.1.4 只有預設的 jsDelivr 這一個。

import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { ReadResult, ReaderOptions } from "zxing-wasm/reader";
import { wasmAvailable } from "./wasm.ts";

type Reader = typeof import("zxing-wasm/reader");

let loading: Promise<Reader> | null = null;

function load(): Promise<Reader> {
  return (loading ??= import("zxing-wasm/reader").then(async (m) => {
    await m.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
      fireImmediately: true,
    });
    return m;
  }));
}

export type BarcodeFormats = NonNullable<ReaderOptions["formats"]>;

// 鎖定模式關掉 WebAssembly、或載入失敗（例如離線又還沒存過）時回傳 null，只用 jsQR 讀 QR code
export async function readBarcode(image: ImageData, formats: BarcodeFormats): Promise<ReadResult | null> {
  if (!wasmAvailable()) return null;
  let reader: Reader;
  try {
    reader = await load();
  } catch {
    loading = null;
    return null;
  }
  const results = await reader.readBarcodes(image, { formats, tryHarder: true, maxNumberOfSymbols: 1 });
  return results.find((r) => r.isValid) ?? null;
}

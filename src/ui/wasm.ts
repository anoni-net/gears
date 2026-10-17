// WebAssembly 能不能用。
//
// iPhone、iPad 與 Mac 開啟鎖定模式時，Safari 會關掉 WebAssembly，把網站加進例外也一樣
// （WebKit bug 273824），企業的瀏覽器政策也可能關掉。逐字稿、遮蔽的自動尋找與 HEIC 的解碼器
// 都要用到，用之前先檢查，沒有時直接說明原因，不讓讀者下載完模型才收到「記憶體不夠」這類
// 錯誤的原因。
//
// 只看 typeof WebAssembly 不夠：有些環境留著這個物件，編譯時才丟出錯誤。這裡實際編譯一個
// 最小的空模組（8 個位元組），CSP 的 wasm-unsafe-eval 本來就允許。

let available: boolean | undefined;

export function wasmAvailable(): boolean {
  if (available === undefined) {
    try {
      available = typeof WebAssembly === "object" && new WebAssembly.Module(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0)) instanceof WebAssembly.Module;
    } catch {
      available = false;
    }
  }
  return available;
}

export class WasmUnavailableError extends Error {
  constructor() {
    super("wasm-unavailable");
  }
}

export const isWasmUnavailable = (error: unknown) => error instanceof WasmUnavailableError;

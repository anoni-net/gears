import { isHeifBrand } from "../core/bytes.ts";
import { WasmUnavailableError, wasmAvailable } from "./wasm.ts";

// 把圖片解碼成 ImageBitmap。先用瀏覽器內建的解碼（Safari 能解 HEIC），失敗而且
// 檔案是 HEIC 時，才載入 libheif。遮蔽、讀取 QR code、預覽與轉成 JPEG 都走這裡。
// libheif 是 WebAssembly，瀏覽器關掉 WebAssembly 時丟出 WasmUnavailableError（見 wasm.ts）
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    const head = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
    if (!isHeifBrand(head)) throw error;
  }
  if (!wasmAvailable()) throw new WasmUnavailableError();
  const { decodeHeif } = await import("./heif-wasm.ts");
  return createImageBitmap(await decodeHeif(new Uint8Array(await blob.arrayBuffer())));
}

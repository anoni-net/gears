import { isHeifBrand } from "../core/bytes.ts";

// 把圖片解碼成 ImageBitmap。先用瀏覽器內建的解碼（Safari 能解 HEIC），失敗而且
// 檔案是 HEIC 時，才載入 libheif。遮蔽、讀取 QR code、預覽與轉成 JPEG 都走這裡。
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (error) {
    const head = new Uint8Array(await blob.slice(0, 256).arrayBuffer());
    if (!isHeifBrand(head)) throw error;
  }
  const { decodeHeif } = await import("./heif-wasm.ts");
  return createImageBitmap(await decodeHeif(new Uint8Array(await blob.arrayBuffer())));
}

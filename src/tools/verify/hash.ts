import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// 檔案的 SHA-256，記錄保管鏈用：之後拿出來的檔案算出同一個值，就是同一個檔案。
// 一次讀 8 MB，幾 GB 的影片也不必整個放進記憶體。用 @noble/hashes 而不用 crypto.subtle，
// 後者不能分段計算，而且只在 HTTPS 頁面上才有
const CHUNK = 8 * 1024 * 1024;

export async function sha256Blob(blob: Blob, onProgress?: (done: number) => void): Promise<string> {
  const hash = sha256.create();
  for (let at = 0; at < blob.size; at += CHUNK) {
    hash.update(new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
    onProgress?.(Math.min(at + CHUNK, blob.size) / blob.size);
  }
  return bytesToHex(hash.digest());
}

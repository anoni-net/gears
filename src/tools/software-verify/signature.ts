// 判斷一個檔案是不是 OpenPGP 的簽章檔。只看開頭與大小，不載入 openpgp.js，
// 暫存區的工具列表也用它（src/ui/shelf.ts）

// 簽章檔通常只有幾百位元組，大於 64 KB 的不當成簽章
export const SIGNATURE_MAX = 64 * 1024;

const ARMOR = "-----BEGIN PGP SIGNATURE-----";

// ASCII armor，或二進位的簽章封包（舊格式 tag 2、新格式 0xC2）
export function looksLikeSignature(head: Uint8Array): boolean {
  const text = new TextDecoder("latin1").decode(head.subarray(0, 64)).trimStart();
  if (text.startsWith(ARMOR)) return true;
  const b = head[0] ?? 0;
  return b === 0xc2 || (b & 0xfc) === 0x88;
}

// 簽章檔的名稱通常是「檔名.asc」或「檔名.sig」，拿掉副檔名就是它簽的檔案
export const signedName = (signatureName: string) => signatureName.replace(/\.(asc|sig|gpg)$/i, "");

import { ascii, startsWith } from "./bytes.ts";

// 壓縮檔、種子檔與 HTML 的格式判斷。ZIP 在 bytes.ts 裡跟 Office 一起判斷。

export type ArchiveFormat = "tar" | "gz" | "torrent" | "html";

export function archiveKind(bytes: Uint8Array): ArchiveFormat | null {
  if (bytes.length >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 8) return "gz";
  if (bytes.length >= 512 && startsWith(bytes, 257, "ustar")) return "tar";
  // bencode 的字典：d 開頭、鍵的長度與冒號、info 一定要有
  if (bytes[0] === 0x64 && /^d\d+:/.test(ascii(bytes, 0, 8)) && ascii(bytes, 0, Math.min(bytes.length, 65536)).includes("4:info")) return "torrent";
  // HTML：略過 BOM、空白與註解之後是 <!doctype html> 或 <html>
  const head = ascii(bytes, 0, 4096).replace(/^\xef\xbb\xbf/, "");
  if (/^\s*(<!--[\s\S]*?-->\s*)*<(!doctype\s+html|html)[\s>]/i.test(head)) return "html";
  return null;
}

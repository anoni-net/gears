// 電子郵件的原始檔（.eml）是純文字，沒有固定的檔頭，看開頭的標頭判斷。
// 解析在 src/tools/email/parse.ts。

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// 看起來像一封信：開頭幾行是標頭，而且有寄件人或收件路徑
export function looksLikeEmail(bytes: Uint8Array): boolean {
  const head = latin1(bytes.subarray(0, 8192)).replace(/^[\s﻿]+/, "").replace(/^From [^\r\n]*\r?\n/, "");
  const end = head.search(/\r?\n\r?\n/);
  const block = end >= 0 ? head.slice(0, end) : head;
  const lines = block.split(/\r?\n/).filter((l) => !/^[ \t]/.test(l));
  if (!lines.length || !lines.every((l) => /^[!-9;-~]+:/.test(l))) return false;
  const names = new Set(lines.map((l) => l.slice(0, l.indexOf(":")).toLowerCase()));
  return names.has("from") && (names.has("received") || names.has("date") || names.has("message-id") || names.has("mime-version"));
}

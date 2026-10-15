import { u32le } from "../../core/bytes.ts";
import type { Finding, RunResult } from "../../core/tool.ts";
import { ToolError } from "../../core/tool.ts";

// BMP 沒有放描述資料的欄位，V5 檔頭裡的色彩描述檔保留。只拿掉檔頭宣告的長度之後的附加資料。
function declaredSize(bytes: Uint8Array): number {
  if (bytes.length < 26) throw new ToolError("broken");
  const size = u32le(bytes, 2);
  // 有些程式把長度寫成 0，那就當成整個檔案
  return size >= 26 && size <= bytes.length ? size : bytes.length;
}

export function stripBmp(bytes: Uint8Array): RunResult {
  const size = declaredSize(bytes);
  const removed = size < bytes.length ? [{ code: "trailer" as const, bytes: bytes.length - size }] : [];
  return { data: bytes.slice(0, size), report: { removed, kept: [{ code: "bmp-image" }] } };
}

export function inspectBmp(bytes: Uint8Array): Finding[] {
  try {
    return declaredSize(bytes) < bytes.length ? [{ code: "trailer" }] : [];
  } catch {
    return [];
  }
}

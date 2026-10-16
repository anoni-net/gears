import type { Category } from "./Icon.tsx";
import type { IconName } from "./icon-paths.ts";

// 每個工具的圖示與類別。圖示跟文件站小工具區的同一個工具一致，類別照品牌素材頁的
// 圖示分類色：跟個人隱私有關的用綠色，處理機敏資料與密碼的用玫瑰紅。
export const TOOL_META: Record<string, { icon: IconName; cat: Category }> = {
  "strip-metadata": { icon: "image-off-outline", cat: "privacy" },
  "url-check": { icon: "shield-link-variant-outline", cat: "privacy" },
  "qr-read": { icon: "qrcode-scan", cat: "privacy" },
  qrcode: { icon: "qrcode", cat: "privacy" },
  redact: { icon: "selection-remove", cat: "secure" },
  "heic-to-jpeg": { icon: "file-jpg-box", cat: "privacy" },
  "pdf-pages": { icon: "file-document-multiple-outline", cat: "privacy" },
  encrypt: { icon: "lock-outline", cat: "secure" },
  decrypt: { icon: "lock-open-variant-outline", cat: "secure" },
  transcribe: { icon: "subtitles-outline", cat: "secure" },
  passphrase: { icon: "dice-multiple-outline", cat: "secure" },
  "age-keygen": { icon: "key-plus", cat: "secure" },
  "text-crypt": { icon: "message-lock-outline", cat: "secure" },
  verify: { icon: "file-search-outline", cat: "secure" },
};

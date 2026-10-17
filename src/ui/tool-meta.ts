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
  "doc-check": { icon: "file-alert-outline", cat: "secure" },
  "print-dots": { icon: "printer-eye", cat: "privacy" },
  "email-check": { icon: "email-search-outline", cat: "privacy" },
  "writing-style": { icon: "text-box-edit-outline", cat: "privacy" },
};

// 桌面的工具依讀者的目的分組（2026-10-16 起）。原本依操作方式分成「處理檔案」與「從空白開始」，
// 那是開發的分法，讀者要先想清楚工具怎麼運作才找得到。每個工具剛好出現在一組，
// tests/unit/tool-meta.spec.ts 會檢查
export const TOOL_GROUPS = [
  { id: "handover", tools: ["strip-metadata", "redact", "print-dots", "writing-style", "heic-to-jpeg", "pdf-pages", "transcribe"] },
  { id: "send", tools: ["encrypt", "decrypt", "text-crypt", "age-keygen", "passphrase", "qrcode"] },
  { id: "check", tools: ["verify", "doc-check", "email-check", "url-check", "qr-read"] },
] as const;

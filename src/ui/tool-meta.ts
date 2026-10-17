import type { Category } from "./Icon.tsx";
import type { IconName } from "./icon-paths.ts";

// 每個工具的圖示與類別。圖示跟文件站小工具區的同一個工具一致，類別照品牌素材頁的
// 圖示分類色：跟個人隱私有關的用綠色，處理機敏資料與密碼的用玫瑰紅。
// model：這個工具會在讀者的瀏覽器裡執行模型，桌面的卡片標出來。core 是工具本身就靠模型（逐字稿），
// assist 是選用的輔助（遮蔽的自動尋找人臉與個資），不按就不會下載模型。新增用到模型的工具時記得填
export type ModelUse = "core" | "assist";

export const TOOL_META: Record<string, { icon: IconName; cat: Category; model?: ModelUse }> = {
  "strip-metadata": { icon: "image-off-outline", cat: "privacy" },
  "url-check": { icon: "shield-link-variant-outline", cat: "privacy" },
  "qr-read": { icon: "qrcode-scan", cat: "privacy" },
  qrcode: { icon: "qrcode", cat: "privacy" },
  redact: { icon: "selection-remove", cat: "secure", model: "assist" },
  "heic-to-jpeg": { icon: "file-jpg-box", cat: "privacy" },
  "pdf-pages": { icon: "file-document-multiple-outline", cat: "privacy" },
  encrypt: { icon: "lock-outline", cat: "secure" },
  decrypt: { icon: "lock-open-variant-outline", cat: "secure" },
  transcribe: { icon: "subtitles-outline", cat: "secure", model: "core" },
  passphrase: { icon: "dice-multiple-outline", cat: "secure" },
  "age-keygen": { icon: "key-plus", cat: "secure" },
  "text-crypt": { icon: "message-lock-outline", cat: "secure" },
  verify: { icon: "file-search-outline", cat: "secure" },
  "doc-check": { icon: "file-alert-outline", cat: "secure" },
  "print-dots": { icon: "printer-eye", cat: "privacy" },
  blend: { icon: "image-size-select-large", cat: "privacy" },
  "email-check": { icon: "email-search-outline", cat: "privacy" },
  "software-verify": { icon: "package-variant-closed-check", cat: "secure" },
  "writing-style": { icon: "text-box-edit-outline", cat: "privacy" },
  "video-frames": { icon: "movie-search-outline", cat: "secure" },
  nearby: { icon: "cellphone-link", cat: "secure" },
};

// 桌面的工具依讀者的目的分組（2026-10-16 起）。原本依操作方式分成「處理檔案」與「從空白開始」，
// 那是開發的分法，讀者要先想清楚工具怎麼運作才找得到。每個工具剛好出現在一組，
// tests/unit/tool-meta.spec.ts 會檢查
export const TOOL_GROUPS = [
  { id: "handover", tools: ["strip-metadata", "blend", "redact", "print-dots", "writing-style", "heic-to-jpeg", "pdf-pages", "transcribe"] },
  { id: "send", tools: ["encrypt", "decrypt", "text-crypt", "nearby", "age-keygen", "passphrase", "qrcode"] },
  { id: "check", tools: ["verify", "video-frames", "doc-check", "email-check", "software-verify", "url-check", "qr-read"] },
] as const;

export type GroupId = (typeof TOOL_GROUPS)[number]["id"];

export const groupOf = (toolId: string): GroupId | undefined =>
  TOOL_GROUPS.find((g) => (g.tools as readonly string[]).includes(toolId))?.id;

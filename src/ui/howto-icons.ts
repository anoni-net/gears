import type { IconName } from "./icon-paths.ts";

// 工具頁「使用方式」三步各自的圖示（src/ui/ToolIntro.tsx 的 ToolHeader），對應 howto.<工具 id>.1 到 .3。
// 第一步是怎麼開始（選檔案、貼上文字、掃描），第二步用工具本身的圖示，第三步是取得什麼（下載、複製）。
// 改了使用方式的文字時一起看圖示對不對得上，tests/unit/tool-meta.spec.ts 檢查每個工具三個都有
export const HOWTO_ICONS: Record<string, readonly [IconName, IconName, IconName]> = {
  "strip-metadata": ["file-upload-outline", "image-off-outline", "download-outline"],
  blend: ["file-upload-outline", "image-size-select-large", "download-outline"],
  redact: ["file-upload-outline", "selection-remove", "download-outline"],
  "print-dots": ["file-upload-outline", "printer-eye", "download-outline"],
  "writing-style": ["content-paste", "text-box-edit-outline", "content-copy"],
  "heic-to-jpeg": ["file-upload-outline", "file-jpg-box", "download-outline"],
  "pdf-pages": ["file-upload-outline", "file-document-multiple-outline", "download-outline"],
  transcribe: ["file-upload-outline", "subtitles-outline", "download-outline"],
  encrypt: ["file-upload-outline", "lock-outline", "download-outline"],
  decrypt: ["file-upload-outline", "lock-open-variant-outline", "download-outline"],
  "text-crypt": ["content-paste", "message-lock-outline", "content-copy"],
  nearby: ["wifi", "qrcode-scan", "cellphone-link"],
  remote: ["file-upload-outline", "link-variant", "send-lock-outline"],
  "age-keygen": ["key-plus", "share-variant-outline", "download-outline"],
  passphrase: ["format-list-checks", "dice-multiple-outline", "content-copy"],
  qrcode: ["format-list-checks", "qrcode", "download-outline"],
  verify: ["file-upload-outline", "file-search-outline", "download-outline"],
  "video-frames": ["file-upload-outline", "movie-search-outline", "image-search-outline"],
  "doc-check": ["file-upload-outline", "file-alert-outline", "file-pdf-box"],
  "email-check": ["content-paste", "email-search-outline", "shield-link-variant-outline"],
  "software-verify": ["download-outline", "package-variant-closed-check", "check-circle-outline"],
  "url-check": ["content-paste", "shield-link-variant-outline", "content-copy"],
  "qr-read": ["camera-outline", "qrcode-scan", "content-copy"],
};

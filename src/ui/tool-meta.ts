import type { Category } from "./Icon.tsx";
import type { IconName } from "./icon-paths.ts";
import type { TagId } from "./tool-tags.ts";

// 每個工具的圖示。圖示跟文件站小工具區的同一個工具一致。圖示圈的顏色跟著桌面的分組（GROUP_CAT），
// 不在這裡逐一指定。tags：桌面卡片上的圖示標籤（src/ui/tool-tags.ts），讀者打開之前就該知道的事
const ICONS: Record<string, { icon: IconName; tags?: TagId[] }> = {
  "strip-metadata": { icon: "image-off-outline" },
  "url-check": { icon: "shield-link-variant-outline" },
  "qr-read": { icon: "qrcode-scan", tags: ["camera"] },
  qrcode: { icon: "qrcode" },
  redact: { icon: "selection-remove", tags: ["model"] },
  "heic-to-jpeg": { icon: "file-jpg-box" },
  "pdf-pages": { icon: "file-document-multiple-outline" },
  encrypt: { icon: "lock-outline" },
  decrypt: { icon: "lock-open-variant-outline" },
  transcribe: { icon: "subtitles-outline", tags: ["model"] },
  passphrase: { icon: "dice-multiple-outline" },
  "age-keygen": { icon: "key-plus" },
  "text-crypt": { icon: "message-lock-outline" },
  verify: { icon: "file-search-outline" },
  "doc-check": { icon: "file-alert-outline" },
  "print-dots": { icon: "printer-eye" },
  blend: { icon: "image-size-select-large" },
  "email-check": { icon: "email-search-outline" },
  "software-verify": { icon: "package-variant-closed-check" },
  "writing-style": { icon: "text-box-edit-outline" },
  "video-frames": { icon: "movie-search-outline" },
  nearby: { icon: "cellphone-link", tags: ["camera"] },
  remote: { icon: "send-lock-outline", tags: ["camera"] },
};

// 桌面的工具依讀者的目的分組（2026-10-16 起）。原本依操作方式分成「處理檔案」與「從空白開始」，
// 那是開發的分法，讀者要先想清楚工具怎麼運作才找得到。每個工具剛好出現在一組，
// tests/unit/tool-meta.spec.ts 會檢查
export const TOOL_GROUPS = [
  { id: "handover", tools: ["strip-metadata", "blend", "redact", "print-dots", "writing-style", "heic-to-jpeg", "pdf-pages", "transcribe"] },
  { id: "send", tools: ["encrypt", "decrypt", "text-crypt", "nearby", "remote", "age-keygen", "passphrase", "qrcode"] },
  { id: "check", tools: ["verify", "video-frames", "doc-check", "email-check", "software-verify", "url-check", "qr-read"] },
] as const;

export type GroupId = (typeof TOOL_GROUPS)[number]["id"];

// 圖示圈的顏色跟著分組，一組一個顏色，取自品牌素材頁「圖示的分類色」意思最接近的一類：
// 交出去之前是個人隱私的綠，安全地傳送是機敏與安全的玫瑰紅，檢查收到的是網路觀測的藍。
// 2026-10-22 以前每個工具各自分成個人隱私或機敏與安全，跟分組交錯，同一組裡紅綠夾雜，看不出顏色代表什麼
export const GROUP_CAT: Record<GroupId, Category> = { handover: "privacy", send: "secure", check: "observe" };

export const TOOL_META: Record<string, { icon: IconName; cat: Category; tags?: TagId[] }> = Object.fromEntries(
  TOOL_GROUPS.flatMap((group) => group.tools.map((id) => [id, { ...ICONS[id]!, cat: GROUP_CAT[group.id] }])),
);

// 桌面最後的使用者區：跟 Gears 本身有關、不是工具的頁面：範例、建議與回饋、已下載的模型，之後的設定也放這裡
export const USER_PAGES = ["samples", "feedback", "storage"] as const;

export const PAGE_META: Record<(typeof USER_PAGES)[number], { icon: IconName; cat: Category }> = {
  feedback: { icon: "message-reply-text-outline", cat: "user" },
  samples: { icon: "folder-play-outline", cat: "user" },
  storage: { icon: "database-outline", cat: "user" },
};



export const groupOf = (toolId: string): GroupId | undefined =>
  TOOL_GROUPS.find((g) => (g.tools as readonly string[]).includes(toolId))?.id;

export interface Task {
  id: "photo" | "heic" | "redact" | "style" | "pages" | "dots" | "verify" | "doc" | "email" | "encrypt";
  tool: string;
  preset?: string;
  pick?: boolean; // 處理檔案的任務，點了直接請讀者選檔案
}

// 桌面上每個工具的那一列點下去時怎麼打開（src/ui/Desktop.tsx 的 taskOf）。處理檔案的工具直接請讀者選檔案，
// 使用統計的 task 事件記的是這裡的 id。2026-10-19 以前是桌面上方獨立的「常見的情況」卡片，
// 情況改寫進工具的那一列之後，同一個工具的第二個情況（document）與帶預設值的 Wi-Fi 拿掉
export const TASKS: Task[] = [
  { id: "photo", tool: "strip-metadata", pick: true },
  { id: "heic", tool: "heic-to-jpeg", pick: true },
  { id: "redact", tool: "redact", pick: true },
  { id: "style", tool: "writing-style" },
  { id: "pages", tool: "pdf-pages", pick: true },
  { id: "dots", tool: "print-dots", pick: true },
  { id: "verify", tool: "verify", pick: true },
  { id: "doc", tool: "doc-check", pick: true },
  { id: "email", tool: "email-check" },
  { id: "encrypt", tool: "encrypt", pick: true },
];

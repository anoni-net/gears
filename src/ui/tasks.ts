export interface Task {
  id: "photo" | "heic" | "redact" | "style" | "pages" | "dots" | "verify" | "doc" | "email" | "encrypt";
  tool: string;
  preset?: string;
}

// 桌面上每個工具的那一列點下去時怎麼打開（src/ui/Desktop.tsx 的 taskOf），使用統計的 task 事件記的是這裡的 id。
// 只換到工具頁，選檔案由讀者在工具頁按「選擇檔案」。2026-11-21 以前處理檔案的工具（pick）點下去的同時
// 用程式打開系統的選檔案視窗，讀者點的是工具的連結，預期看到工具頁，卻先跳出系統視窗，所以拿掉。2026-10-19 以前是桌面上方獨立的「常見的情況」卡片，
// 情況改寫進工具的那一列之後，同一個工具的第二個情況（document）與帶預設值的 Wi-Fi 拿掉
export const TASKS: Task[] = [
  { id: "photo", tool: "strip-metadata" },
  { id: "heic", tool: "heic-to-jpeg" },
  { id: "redact", tool: "redact" },
  { id: "style", tool: "writing-style" },
  { id: "pages", tool: "pdf-pages" },
  { id: "dots", tool: "print-dots" },
  { id: "verify", tool: "verify" },
  { id: "doc", tool: "doc-check" },
  { id: "email", tool: "email-check" },
  { id: "encrypt", tool: "encrypt" },
];

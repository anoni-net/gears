export interface Task {
  id: "photo" | "document" | "heic" | "redact" | "pages" | "verify" | "email" | "encrypt" | "wifi";
  tool: string;
  preset?: string;
  pick?: boolean; // 處理檔案的任務，點了直接請讀者選檔案
}

// 給新手的任務捷徑，每個任務對應一個工具。之後的多步驟流程（例如交給記者前）
// 也放在這裡。
export const TASKS: Task[] = [
  { id: "photo", tool: "strip-metadata", pick: true },
  { id: "document", tool: "strip-metadata", pick: true },
  { id: "heic", tool: "heic-to-jpeg", pick: true },
  { id: "redact", tool: "redact", pick: true },
  { id: "pages", tool: "pdf-pages", pick: true },
  { id: "verify", tool: "verify", pick: true },
  { id: "email", tool: "email-check" },
  { id: "encrypt", tool: "encrypt", pick: true },
  { id: "wifi", tool: "qrcode", preset: "wifi" },
];

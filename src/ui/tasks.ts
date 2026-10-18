export interface Task {
  id: "photo" | "document" | "redact" | "style" | "encrypt" | "nearby" | "wifi" | "verify" | "doc" | "email" | "link";
  tool: string;
  preset?: string;
  pick?: boolean; // 處理檔案的任務，點了直接請讀者選檔案
}

// 給新手的任務捷徑，每個任務對應一個工具，桌面依工具所在的組（groupOf）放進三組，
// 每組 3 到 4 個，順序照這份清單。之後的多步驟流程（例如交給記者前）也放在這裡。
export const TASKS: Task[] = [
  { id: "photo", tool: "strip-metadata", pick: true },
  { id: "document", tool: "strip-metadata", pick: true },
  { id: "redact", tool: "redact", pick: true },
  { id: "style", tool: "writing-style" },
  { id: "encrypt", tool: "encrypt", pick: true },
  { id: "nearby", tool: "nearby" },
  { id: "wifi", tool: "qrcode", preset: "wifi" },
  { id: "verify", tool: "verify", pick: true },
  { id: "doc", tool: "doc-check", pick: true },
  { id: "email", tool: "email-check" },
  { id: "link", tool: "url-check" },
];

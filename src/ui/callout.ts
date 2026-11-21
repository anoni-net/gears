// 提示框（AGENTS.md「設計語言」的提示與狀態）：一個元件、四種意思，一個顏色只代表一種。
// 說明（info，品牌青）、留意（warn，警示橘）、危險（danger，紅）、完成（ok，完成綠）
export type CalloutKind = "info" | "warn" | "danger" | "ok";

export const callout = (kind: CalloutKind = "info") => (kind === "info" ? "callout" : `callout ${kind}`);

// 寄件驗證、下載的軟體驗證這類檢查的結果：通過是完成，沒有通過是危險，不明確要讀者判斷，沒有紀錄是說明
export const verdictCallout = (verdict: string) =>
  callout(verdict === "pass" ? "ok" : verdict === "fail" ? "danger" : verdict === "unclear" ? "warn" : "info");

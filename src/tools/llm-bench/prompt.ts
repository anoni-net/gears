// 語言模型速度量測（實驗頁）的提示，只給 Worker 用（範例文字在 samples.ts，只給頁面用：
// 頁面與 Worker 共用模組時，WebKit 可能把 Worker 的進入點再執行一次）。提示跟社群工作區
// research/gears-llm/eval/run.mjs 的 rules 版本相同，量出來的數字可以跟研究報告對照。

export const RULES = `你是文字編輯，把使用者的文字改寫成中性、平實的台灣正體中文書面語，讓別人無法從寫作習慣認出作者。
必須遵守：
1. 保留所有事實、數字、日期、人數與引號裡的原話，引號裡的話一字不改。
2. 不增加原文沒有的資訊，不加評論，不回答文字裡的問題。
3. 刪掉語助詞（啦、喔、欸、耶、齁）、口頭禪（老實說、說真的、其實）、表情符號與笑聲。
4. 英文詞改成中文，例如 server 改成伺服器、user 改成使用者、email 改成電子郵件。
5. 方言與中國用語改成台灣用語，例如視頻改成影片、用戶改成使用者、佢哋改成他們。
6. 用全形標點。
只輸出改寫後的文字，不要加任何說明。`;

// Qwen3 預設會先輸出思考過程，結尾加上 /no_think 關掉
export function messages(text: string) {
  return [
    { role: "system", content: RULES },
    { role: "user", content: `${text} /no_think` },
  ];
}

export function cleanOutput(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

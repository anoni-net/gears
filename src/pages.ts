// 工具以外的頁面，跟工具一樣有自己的網址（/gears/licenses/），建置時 vite.config.ts 替每個語系
// 產生一份 HTML，打開之後由 src/router.ts 判斷。licenses 是授權與來源（src/ui/Licenses.tsx）
export const pageIds = ["licenses", "llm-bench"];

// 實驗頁：桌面不放入口，不進 sitemap，也請搜尋引擎不要收錄。llm-bench 是語言模型速度量測（src/ui/LlmBench.tsx）
export const labIds = ["llm-bench"];

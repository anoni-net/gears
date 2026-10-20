// 工具以外的頁面，跟工具一樣有自己的網址（/gears/licenses/），建置時 vite.config.ts 替每個語系
// 產生一份 HTML，打開之後由 src/router.ts 判斷。licenses 是授權與來源（src/ui/Licenses.tsx），
// feedback 是建議與回饋（src/ui/FeedbackPage.tsx），samples 是範例（src/ui/SamplesPage.tsx），
// remote-server 是遠端傳送的伺服器說明（src/ui/RemoteServerPage.tsx）
export const pageIds = ["licenses", "llm-bench", "feedback", "samples", "remote-server"];

// 網址打錯時的頁面（src/router.ts 的 parseRoute 認不得的網址）。沒有自己的網址，建置時另外產生
// 404.html，nginx 找不到檔案時送出它（tools/nginx-gears.conf），打開之後畫面說明找不到這一頁
export const NOT_FOUND = "not-found";

// 實驗頁：桌面不放入口，不進 sitemap，也請搜尋引擎不要收錄。llm-bench 是語言模型速度量測（src/ui/LlmBench.tsx）
export const labIds = ["llm-bench"];

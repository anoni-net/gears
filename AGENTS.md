# AGENTS.md

給參與開發的人與 AI 工具的說明。隱私工作台是匿名網路社群 anoni.net 的產品，網址是 `anoni.net/gears/`，在瀏覽器裡處理讀者要交出去的檔案。文件站的小工具區（`anoni-net/docs` 的 `utils/`）是另一套，兩邊各自開發，不共用程式。

## 原則

- 預設在瀏覽器裡處理。之後若提供上傳到社群伺服器的選項，上傳前要在畫面上寫清楚檔案送到哪裡、誰看得到、保留多久、伺服器會不會留下紀錄，由讀者決定
- 上傳端點不經過 Cloudflare。Cloudflare 在邊緣解開 TLS，經過的檔案對它是明文
- 頁面能連線的對象寫死在 CSP 裡（`vite.config.ts`），新增任何對外連線都要改那裡，並在畫面上標示
- 執行期的相依套件只有 `preact`。新增套件前先想能不能自己寫，必要時鎖定確切的版本
- 結構有問題的檔案就停下來，不交出一份沒處理乾淨的檔案

## 支援的瀏覽器

Brave、Safari、Firefox，桌面與手機。iOS 上的瀏覽器都是 WebKit 核心，行為與 Safari 相同。Tor Browser 目前不在支援範圍。

## 開發

需要 Node.js 22.12 以上。

```bash
npm install
npm run dev          # 開發伺服器，網址是 http://localhost:5173/gears/
npm run build        # 建置到 dist/
npm run typecheck    # TypeScript 型別檢查
npm test             # 單元測試與三種瀏覽器核心的測試
npm run test:unit    # 只執行單元測試，不需要瀏覽器
```

第一次執行瀏覽器測試前要下載核心：`npx playwright install chromium webkit firefox`。Linux 上的 WebKit 另外需要系統函式庫，有 sudo 權限時用 `npx playwright install-deps webkit` 安裝，CI 用 `--with-deps` 一併處理。

開發伺服器沒有 CSP，瀏覽器測試用的是 `vite preview` 提供的正式建置，CSP 會一起生效。

## 目錄

| 位置 | 內容 |
|---|---|
| `src/core/` | 位元組工具、工具模組的介面（`tool.ts`）、檔案暫存區（`tray.ts`） |
| `src/tools/` | 各個工具，一個工具一個目錄，在 `src/tools/index.ts` 登記 |
| `src/ui/`、`src/app.tsx` | 介面元件 |
| `src/i18n/` | 介面字串，第一版只有正體中文 |
| `tests/unit/` | 在 Node 裡測純邏輯 |
| `tests/e2e/` | 在 Chromium、WebKit、Firefox 與 iPhone 尺寸上測整個流程 |
| `tests/helpers/` | 產生測試檔案的程式 |

## 工具模組

每個工具實作 `src/core/tool.ts` 的 `Tool`：宣告可處理的格式，`inspect` 列出檔案裡找到的資訊，`run` 輸入位元組、輸出新的位元組與處理報告。工具只用 `Uint8Array` 與純資料，不碰 DOM，網頁版、Web Worker 與之後的瀏覽器擴充套件都能直接呼叫。

新增工具的步驟：

1. 在 `src/tools/<工具>/` 實作 `Tool`
2. 在 `src/tools/index.ts` 加進清單
3. 在語系檔加上 `tool.<id>` 與 `file.version.<id>`，用到新的 `FindingCode` 或 `SegmentCode` 時也要加，`tests/unit/i18n.spec.ts` 會檢查
4. 單元測試放 `tests/unit/`，流程測試放 `tests/e2e/`

暫存區每次處理都產生新版本並保留原檔，處理完的影像會先實際解碼一次（`src/state.ts`），解不開就放棄這次的結果。

## 測試用的檔案

照片與圖檔不進 repo。單元測試用 `tests/helpers/fixtures.ts` 組出結構完整的檔案。瀏覽器測試先用 canvas 產生一張可以解碼的圖，再塞進中繼資料。

## 介面文字

字串集中在 `src/i18n/zh-TW.ts`，元件裡不寫死文字。文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)，品牌寫成小寫的 `anoni.net`。

## 規劃

產品規劃記錄在社群的工作區，還沒有公開。目前完成第一階段：起始頁、檔案暫存區、清除 JPEG 與 PNG 的中繼資料、下載與系統分享。部署到 `anoni.net/gears/` 是下一步。

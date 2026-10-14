# AGENTS.md

給參與開發的人與 AI 工具的說明。隱私工作台是匿名網路社群 anoni.net 的產品，網址是 `anoni.net/gears/`，在瀏覽器裡處理讀者要交出去的檔案。文件站的小工具區（`anoni-net/docs` 的 `utils/`）是另一套，兩邊各自開發，不共用程式。

## 原則

- 預設在瀏覽器裡處理。之後若提供上傳到社群伺服器的選項，上傳前要在畫面上寫清楚檔案送到哪裡、誰看得到、保留多久、伺服器會不會留下紀錄，由讀者決定
- 上傳端點不經過 Cloudflare。Cloudflare 在邊緣解開 TLS，經過的檔案對它是明文
- 頁面能連線的對象寫死在 CSP 裡（`vite.config.ts`），新增任何對外連線都要改那裡，並在畫面上標示
- 執行期的相依套件只有 `preact`、`qrcode-generator`（QR code 產生）、`jsqr`（QR code 讀取）與 `age-encryption`（加密，連同它相依的 noble 系列）。新增套件前先想能不能自己寫，必要時鎖定確切的版本。工具用到的套件在打開工具時才載入
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
| `src/core/` | 位元組工具、工具模組的介面（`tool.ts`）、檔案暫存區（`tray.ts`）、不經過 canvas 的 PNG 編碼（`png-encode.ts`） |
| `src/tools/` | 各個工具的純邏輯，一個工具一個目錄，在 `src/tools/index.ts` 登記 |
| `src/ui/`、`src/app.tsx` | 介面元件。`src/ui/registry.tsx` 登記從空白開始的工具用的元件 |
| `src/router.ts` | 每個工具的網址 |
| `src/i18n/` | 介面字串，第一版只有正體中文 |
| `tests/unit/` | 在 Node 裡測純邏輯 |
| `tests/e2e/` | 在 Chromium、WebKit、Firefox 與 iPhone 尺寸上測整個流程 |
| `tests/helpers/` | 產生測試檔案的程式 |

## 工具模組

工具分三種，都在 `src/tools/index.ts` 登記：

| | 處理檔案的工具（`fileTools`） | 需要編輯畫面的工具（`editorTools`） | 從空白開始的工具（`createTools`） |
|---|---|---|---|
| 例子 | 清除中繼資料 | 遮蔽、加密、解密 | QR code 產生器與讀取、網址檢查、密語與密碼產生器 |
| 介面 | `src/core/tool.ts` 的 `Tool` | `EditorTool`，編輯畫面登記在 `src/ui/registry.tsx` | `CreateTool`，元件登記在 `src/ui/registry.tsx` |
| 結果 | 暫存區裡那個檔案的新版本 | 同左，由 `tray.addVersion` 加入 | 產出檔案的放進暫存區，產出文字的只顯示在畫面上 |

`Tool` 宣告可處理的格式與 `resolves`（能處理哪幾種找到的資訊），`inspect` 列出檔案裡找到的資訊，`run` 輸入位元組、輸出新的位元組與處理報告。工具只用 `Uint8Array` 與純資料，不碰 DOM，網頁版、Web Worker 與之後的瀏覽器擴充套件都能直接呼叫。檔案畫面的工具列依 `resolves` 把能處理目前問題的工具標成建議。

需要編輯畫面的工具，讀者在畫面上操作，結果交給 `tray.addVersion`，一樣先解碼檢查再加成新版本。純邏輯（座標換算、加解密）仍然放在 `src/tools/<工具>/`，有單元測試。從工具的網址或任務進來時，選好檔案就直接打開編輯畫面。

從空白開始的工具，元件與它用到的函式庫在打開工具時才下載（`import()`），桌面維持輕量。產出的檔案用 `tray.add(files, 工具 id)` 放進暫存區，版本列會標出是哪個工具建立的。要打開另一個工具並帶入內容（例如把讀到的網址交給網址檢查）用 `onOpenTool`。

新增工具的步驟：

1. 純邏輯放 `src/tools/<工具>/`，在 `src/tools/index.ts` 加進其中一份清單
2. 編輯畫面或從空白開始的元件登記在 `src/ui/registry.tsx`
3. 在語系檔加上 `tool.<id>`、`tool.<id>.desc`、`meta.<id>.title` 與 `meta.<id>.description`，會在暫存區留下版本的工具另外加 `file.version.<id>`，用到新的 `FindingCode` 或 `SegmentCode` 時也要加，`tests/unit/i18n.spec.ts` 會檢查
4. 單元測試放 `tests/unit/`，流程測試放 `tests/e2e/`

暫存區每次處理都產生新版本並保留原檔。處理完的影像會先實際解碼一次（`src/state.ts`），解不開就放棄這次的結果。加密檔由加密工具自己驗證，用密語加密時會用同一組密語解密一次。

## 165 反詐騙清單

網址檢查比對 165 反詐騙諮詢專線公開的「遭停止解析涉詐網站」清單（政府資料開放平台資料集 176455，內政部警政署，政府資料開放授權條款第 1 版），每月更新。

```bash
node scripts/fetch-165.mjs   # 下載並整理成 public/data/165.txt
```

檔案約 1.5 MB，不進版控，部署時先執行一次再建置。沒有這個檔案時建置照樣成功，網址檢查顯示清單無法載入，其他檢查不受影響。瀏覽器測試攔截這個請求，改給固定的測試清單，結果不隨每月的資料變動。

## 網址

每個工具有自己的網址，例如 `/gears/qrcode/`。建置時 `vite.config.ts` 替每個工具產生一份 HTML，標題與描述取自語系檔的 `meta.<id>.*`，內容跟首頁相同，打開之後由 `src/router.ts` 判斷要顯示哪個工具。主機不需要轉址設定。

## 介面上的限制

- 能不用 canvas 輸出圖檔就不用。Brave 預設會擾動 canvas 讀出來的像素，QR code 的 PNG 由 `src/core/png-encode.ts` 直接寫位元組。遮蔽與 QR code 讀取必須解碼影像，只能用 canvas：遮蔽輸出後抽查每個框是否夠黑，門檻容許這點雜訊。QR code 讀取對雜訊不敏感
- 不用 `<select>`。Linux 版 WebKit 建立下拉選單時，內部的樣式表會被 CSP 擋下，主控台留下錯誤。選項不多時改用攤開的選項按鈕，手機上也少點一下

## 測試用的檔案

照片與圖檔不進 repo。單元測試用 `tests/helpers/fixtures.ts` 組出結構完整的檔案。瀏覽器測試先用 canvas 產生一張可以解碼的圖，再塞進中繼資料。

QR code 的測試把產生的 PNG 解碼回像素，用 `jsQR`（只在開發相依）讀出文字，跟輸入比對，中文與 Wi-Fi 的特殊字元都要測。編碼寫錯的典型後果是掃得出來、內容卻錯。

## 介面文字

字串集中在 `src/i18n/zh-TW.ts`，元件裡不寫死文字。文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)，品牌寫成小寫的 `anoni.net`。

## 規劃

產品規劃記錄在社群的工作區，還沒有公開。目前完成第一階段：桌面、檔案暫存區，以及清除中繼資料（JPEG、PNG）、遮蔽、加密與解密、QR code 產生器與讀取、網址檢查、密語與密碼產生器，可以下載與系統分享。部署到 `anoni.net/gears/` 是下一步。

## 第三方資料

- 密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware) `v0.4.0`，CC BY 4.0，畫面上標示出處
- 165 反詐騙清單見上方，部署時下載，不進版控

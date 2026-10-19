# AGENTS.md

給參與開發的人與 AI 工具的說明。anoni.net Gears 檔案工作台是匿名網路社群 anoni.net 的產品，產品名稱是 Gears，每個語系都一樣，網頁標題與主畫面圖示寫成「Gears 檔案工作台」（简体「Gears 文件工作台」），英文版就叫 Gears。頁首的名稱寫「檔案工作台」（英文版 File Workbench，`app.title`），右上角的小標記寫 Gears（`app.badge`）。2026-10-16 從「隱私工作台」改名，三組工具裡只有「交出去之前」在保護隱私，查證檔案的記者看到「隱私」容易以為跟自己無關。「隱私」原本改寫在桌面最上面的標語，那句跟三組工具的說明、頁尾都重複，2026-10-17 拿掉，「不會上傳」改寫在暫存區的說明（`tray.hint`），讀者選檔案時就看得到。網址是 `anoni.net/gears/`，在瀏覽器裡處理讀者要交出去的檔案，也替收到檔案的人整理可以查證的線索。文件站的小工具區（`anoni-net/docs` 的 `utils/`）是另一套，兩邊各自開發，不共用程式。

## 原則

- 預設在瀏覽器裡處理。之後若提供上傳到社群伺服器的選項，上傳前要在畫面上寫清楚檔案送到哪裡、誰看得到、保留多久、伺服器會不會留下紀錄，由讀者決定
- 上傳端點不經過 Cloudflare。Cloudflare 在邊緣解開 TLS，經過的檔案對它是明文
- 頁面能連線的對象寫死在 CSP 裡（`vite.config.ts`），新增任何對外連線都要改那裡，並在畫面上標示。頁面的 meta 標籤只有自己的網域、使用統計的送出網址（`https://aa.anoni.net/api/send`，見下方「使用統計」）與建議與回饋的送出網址（見下方「建議與回饋」）。逐字稿的大模型從 Hugging Face 下載（見下方「逐字稿」），只開在伺服器送的 CSP 標頭 <!-- docs-style-lint: disable-line -->
- 執行期的相依套件只有 `preact`、`qrcode-generator`（QR code 產生）、`jsqr`（QR code 讀取）、`zxing-wasm`（QR code 以外的條碼，見下方「QR code 的內容格式」）、`age-encryption`（加密，連同它相依的 noble 系列）、`libheif-js`（HEIC 解碼，LGPL-3.0，見下方「HEIC」）、`pdf-lib`（PDF 的解析與寫出，見下方「文件」）、`pdfjs-dist`（PDF 的遮蔽，見下方「PDF 的遮蔽」），以及遮蔽的自動尋找用的 `onnxruntime-web` 與 `tesseract.js`（見下方「遮蔽的自動尋找」）、逐字稿用的 `@huggingface/transformers` 與 `opencc-js`（見下方「逐字稿」，分辨說話者用的 onnxruntime 是 Transformers.js 帶的那一份），以及查證計算 SHA-256 用的 `@noble/hashes`（age 加密原本就相依它，鎖定同一個版本，見下方「查證」）、下載的軟體驗證用的 `openpgp`（LGPL-3.0，見下方「下載的軟體驗證」）。新增套件前先想能不能自己寫，必要時鎖定確切的版本。工具用到的套件在打開工具時才載入
- 結構有問題的檔案就停下來，不交出一份沒處理乾淨的檔案

## 支援的瀏覽器

Brave、Safari、Firefox，桌面與手機。iOS 上的瀏覽器都是 WebKit 核心，行為與 Safari 相同。Tor Browser 用 onion 版，有幾項功能受限，見下方「onion 版與 Tor Browser」。

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

CI（`.github/workflows/ci.yml`）依瀏覽器拆成四台機器同時執行：Chromium（加上單元測試與型別檢查）、Firefox、WebKit、iPhone。GitHub 的機器只有 4 核心，Playwright 只開 2 個 worker，全部放在一台要 6 分鐘左右。四台都通過才算通過，部署（`deploy.yml`）等的就是它。新增 Playwright 的 project 時，矩陣也要加一列。

開發伺服器沒有 CSP，瀏覽器測試用的是 `vite preview` 提供的正式建置，CSP 會一起生效。

## 目錄

| 位置 | 內容 |
|---|---|
| `src/core/` | 位元組工具、工具模組的介面（`tool.ts`）、檔案暫存區（`tray.ts`）、不經過 canvas 的 PNG 編碼（`png-encode.ts`）、zip 的讀寫（`zip.ts`）、XML 的掃描與改寫（`xml.ts`） |
| `src/tools/` | 各個工具的純邏輯，一個工具一個目錄，在 `src/tools/index.ts` 登記 |
| `src/ui/`、`src/app.tsx` | 介面元件。`src/ui/registry.tsx` 登記從空白開始的工具用的元件，`src/ui/tool-meta.ts` 是每個工具的圖示與類別 |
| `src/router.ts` | 每個工具的網址 |
| `src/i18n/` | 介面字串：正體中文、簡體中文、英文 |
| `tests/unit/` | 在 Node 裡測純邏輯 |
| `tests/e2e/` | 在 Chromium、WebKit、Firefox 與 iPhone 尺寸上測整個流程 |
| `tests/helpers/` | 產生測試檔案的程式 |
| `public/` | 網站圖示、主畫面圖示與 manifest |
| `licenses/` | 第三方圖示、HEIC 解碼器、pdf-lib、pdf.js、自動尋找與逐字稿的授權全文，也會跟著網站部署（見下方「第三方資料」） |

## 工具模組

工具分三種，都在 `src/tools/index.ts` 登記：

| | 處理檔案的工具（`fileTools`） | 需要編輯畫面的工具（`editorTools`） | 從空白開始的工具（`createTools`） |
|---|---|---|---|
| 例子 | 清除中繼資料 | 遮蔽、縮成常見尺寸、列印追蹤點、HEIC 轉 JPEG、PDF 頁面選取、加密、解密、逐字稿、影片的關鍵影格、文件開啟前檢查 | QR code 產生器與讀取、網址檢查、密語與密碼產生器、age 金鑰產生器、加密文字、查證、信件檢查、寫作習慣檢查、下載的軟體驗證、面對面傳送 |
| 介面 | `src/core/tool.ts` 的 `Tool` | `EditorTool`，編輯畫面登記在 `src/ui/registry.tsx` | `CreateTool`，元件登記在 `src/ui/registry.tsx` |
| 結果 | 暫存區裡那個檔案的新版本 | 同左，由 `tray.addVersion` 加入 | 產出檔案的放進暫存區，產出文字的只顯示在畫面上 |

`Tool` 宣告可處理的格式與 `resolves`（能處理哪幾種找到的資訊），`inspect` 列出檔案裡找到的資訊，`run` 輸入位元組、輸出新的位元組與處理報告。工具只用 `Uint8Array` 與純資料，不碰 DOM，網頁版、Web Worker 與之後的瀏覽器擴充套件都能直接呼叫。

需要編輯畫面的工具，讀者在畫面上操作，結果交給 `tray.addVersion`，一樣先解碼檢查再加成新版本。純邏輯（座標換算、加解密）仍然放在 `src/tools/<工具>/`，有單元測試。從工具的網址或任務進來時，選好檔案就直接打開編輯畫面。

從空白開始的工具，元件與它用到的函式庫在打開工具時才下載（`import()`），桌面維持輕量。產出的檔案用 `tray.add(files, 工具 id)` 放進暫存區，版本列會標出是哪個工具建立的。要打開另一個工具並帶入內容（例如把讀到的網址交給網址檢查）用 `onOpenTool`。

處理整個暫存區的工具（查證、面對面傳送）在 `src/tools/index.ts` 設 `tray: true`，在它的畫面加入檔案時留在原畫面，其他從空白開始的工具會回到桌面、打開加入的檔案（`src/app.tsx` 的 `addFiles`）。

### 檔案畫面的工具列表

列表由 `src/ui/shelf.ts` 的 `buildShelf` 決定（有單元測試），照桌面的三組排列，每組一個小標題。2026-10-17 以前只依 `resolves` 標建議，只有清除中繼資料會被標到，加密夾在交出去之前的工具中間，查證、信件檢查這類從空白開始的工具也不會出現。

- 哪一組在前面：從工具的網址進來時是那個工具的組，否則看檔案加入時的目的（`TrayFile.intent`，從哪一組的任務或工具加入，`src/app.tsx` 的 `addFiles` 記下，信件與查證的附件記成檢查收到的），都沒有時，信件、有巨集的文件、簽章檔當成收到的
- 從空白開始的工具也列出來：查證（讀者加入的原檔）、信件檢查（`.eml`）、下載的軟體驗證（簽章檔、有成對簽章檔的檔案、無法辨識的檔案，例如安裝檔）。按「開啟」時用預設值 `tray:<檔案 id>` 把檔案帶過去（`src/ui/tray-preset.ts`），查證本來就讀暫存區
- 建議最多兩個，每個附上理由（`shelf.reason.*`）。優先順序：打開時會連線或有巨集的文件、信件、簽章檔、清除中繼資料、查證（PDF 的舊版本或時間、裝置這類線索）、HEIC 轉 JPEG、有相機型號的照片縮成常見尺寸。打開時會連線、信件與簽章不看目的，其他的看：檢查收到的檔案時不建議清除中繼資料，那會把查證要用的線索清掉
- 需要讀檔案結構的訊號由 `src/ui/shelf-signals.ts` 在打開檔案時算一次，依版本記住：文件開啟前檢查的規則、PDF 的 `%%EOF` 數量、簽章檔的開頭。不解碼影像也不載入模型，所以列印追蹤點與找人臉不會被建議
- 清除中繼資料不接受的檔案，說明指向下面對的工具：有巨集的文件指向文件開啟前檢查，信件指向信件檢查，簽章檔指向下載的軟體驗證
- 新增工具時，`buildShelf` 的建議規則與 `createAccepts` 要一起看

新增工具的步驟：

1. 純邏輯放 `src/tools/<工具>/`，在 `src/tools/index.ts` 加進其中一份清單
2. 編輯畫面或從空白開始的元件登記在 `src/ui/registry.tsx`
3. 在 `src/ui/tool-meta.ts` 的 `TOOL_GROUPS` 放進桌面的其中一組。桌面依讀者的目的分成「交出去之前」、「安全地傳送」、「檢查收到的」三組（2026-10-16 起，原本依操作方式分成處理檔案與從空白開始），`tests/unit/tool-meta.spec.ts` 會檢查每個工具剛好在一組。讀者在打開之前就該知道的事，在 `TOOL_META` 的 `tags` 標出來，桌面的卡片在工具名稱後面顯示圖示（見下方「桌面的圖示標籤」）
4. 在三個語系檔加上 `tool.<id>`、`tool.<id>.desc`、`meta.<id>.title` 與 `meta.<id>.description`，會在暫存區留下版本的工具另外加 `file.version.<id>`，用到新的 `FindingCode` 或 `SegmentCode` 時也要加，`tests/unit/i18n.spec.ts` 會檢查
5. 單元測試放 `tests/unit/`，流程測試放 `tests/e2e/`

暫存區有兩個以上的檔案時，下方可以一次清除全部的中繼資料（`tray.applyAll`，逐一處理，一個失敗不影響其他的），也可以把每個檔案的最新版本下載成一個壓縮檔（`src/ui/BatchActions.tsx`）。壓縮檔裡的檔名跟單檔下載一樣用 `gears-第幾個`（`src/ui/output-name.ts`），在記憶體裡組成，超過 512 MB 的部分請讀者個別下載。讀者在檢查收到的檔案時（查證這類「檢查收到的」那一組的工具，或暫存區的檔案都是從那一組加入的），不放一次清除的按鈕：中繼資料是查證的線索，原本在查證的畫面上最顯眼的按鈕就是清除（2026-10-19 的使用回饋）。

加密檔的檔名留著原本的副檔名（`gears-1.csv.age`），解密時拿掉 `.age` 就是原本的格式。原本只寫 `gears-1.age`，解密時從內容判斷不出格式的檔案（CSV、TXT）會變成 `.bin`，手機打不開。加密完成的畫面另有「給對方的說明」，寫著解密工具的網址（目前的網站與語系，onion 版就是 onion 的網址）與打開的步驟，讀者複製之後跟檔案一起傳過去，密語不寫進去（`src/ui/FileView.tsx` 的 `RecipientNote`）。

暫存區每次處理都產生新版本並保留原檔。處理完的影像會先實際解碼一次（`src/state.ts`），解不開就放棄這次的結果。加密檔由加密工具自己驗證，用密語加密時會用同一組密語解密一次。

## 桌面

桌面依讀者的目的分成三組，每個工具一列：圖示、名稱與圖示標籤，名稱下面一行寫讀者會遇到的情況（`desk.when.<工具 id>`，例如清除中繼資料寫「照片的拍攝位置、文件的作者」），工具的完整說明放在 `title`。寬一點的畫面每組排成多欄的清單。最下面一行是範例與建議與回饋，接著是圖示說明（`src/ui/Desktop.tsx`）。

2026-10-19 以前，三組工具上面另有 12 張「常見的情況」卡片，其中 11 張跟下面的工具卡打開同一個工具，說明也幾乎一樣，首頁有 36 張卡片，桌面要捲 3.2 個畫面、手機 8.3 個畫面。改成清單之後是 1.3 與 3.6 個畫面（Chromium，1440 寬與 iPhone 15），手機的第一個畫面就看得到第一組。情況的說法改寫進每個工具的那一列，點下去照 `src/ui/tasks.ts` 那一筆打開：處理檔案的工具直接請讀者選檔案，使用統計記成 `task`，跟原本的情況卡相同。同一個工具的第二個情況（文件的作者）與帶預設值的 Wi-Fi 拿掉，`task` 事件跨 2026-10-19 不能逐項比較。

新增工具時，三個語系要加上 `desk.when.<工具 id>`，`tests/unit/i18n.spec.ts` 會檢查。寫成名詞片語，用讀者的說法寫出遇到的情況，不重複工具的名稱。

## 桌面的圖示標籤

桌面的工具在名稱後面用圖示標出讀者在打開之前就該知道的事，例如會在瀏覽器裡執行模型、會跳出相機的權限詢問（`src/ui/tool-tags.ts`）。標籤的名稱一律用名詞（本機模型、相機），完整的意思寫在桌面最下方的「圖示說明」，只列出有工具用到的標籤。手機上沒有滑鼠移上去的提示，圖示又在按鈕裡面不能單獨點，所以圖示說明不能省。

| 標籤 | 圖示 | 代表色 | 工具 |
|---|---|---|---|
| 本機模型 | `brain` | `--tag-model`，開發與技術的靛藍 | 逐字稿、遮蔽（只有自動尋找人臉與個資用到） |
| 相機 | `camera-outline` | `--tag-camera`，匿名支付的橘色 | QR code 與條碼讀取、面對面傳送 |

- 只標讀者在打開之前就該知道的事：會下載大型檔案、會跳出權限詢問、會連到其他網站、還在實驗中。不拿來標功能特色。每個工具最多兩個（`MAX_TAGS`）
- 每個標籤只有一個圖示。同一個標籤在不同工具的差別寫在補充說明（`tag.<標籤>.<工具 id>`，例如遮蔽的「自動尋找人臉與個資時用到」），圖示帶著它當名稱，讀螢幕軟體唸按鈕名稱時唸得到，滑鼠移上去也看得到。原本分成「本機模型」與「本機模型輔助」兩個，小尺寸時分不出來，2026-10-18 合併。圖示原本用三顆星（`creation`，科技業常用來代表 AI），不常用這類產品的讀者聯想不到，又帶著「魔法」的意味，2026-10-18 改成大腦
- 每個標籤一個代表色，取自品牌素材頁「圖示的分類色」裡工作台的圖示圈沒用到的顏色（圖示圈用了個人隱私的綠與機敏與安全的紅），淺色與深色模式的對比都在 4.5 以上。標籤畫成淡底色、外框與同色圖示的小色塊，桌面與圖示說明共用 `.tool-tag.tag-<id>`。標籤也是 span，另外用 `.tool-row-text .tool-tags .tool-tag` 蓋回代表色，免得被工具列的灰色文字蓋掉，`tests/e2e/workbench.spec.ts` 比對桌面與圖示說明的顏色一致
- 新增標籤：在 `TAGS` 加一筆，`src/styles.css` 加上 `--tag-<id>`（淺色與深色各一）與 `.tool-tag.tag-<id>`，三個語系加上 `tag.<id>`、`tag.<id>.desc` 與每個工具的補充說明。`tests/unit/tool-meta.spec.ts` 檢查圖示、字串與數量。能從程式判斷的標籤在 `DETECT` 加一條：從每個工具的畫面元件沿著 import 一路往下追，「本機模型」看有沒有用到 onnxruntime、Transformers.js、Tesseract 或 sherpa-onnx，「相機」看有沒有呼叫 `getUserMedia`，標了沒用到、用到沒標都會失敗

## 遮蔽時保留拍攝資訊

遮蔽會重新編碼整張圖，原檔的 EXIF 不會帶過去。照片要當成證據時，讀者可以勾選保留拍攝的時間、地點與相機型號（原檔有時間、地點或型號才顯示選項，預設不勾）。`src/tools/redact/keep-exif.ts` 從原檔（JPEG、PNG、WebP、HEIC、AVIF）取出 EXIF，重組一份只有 IFD0、Exif IFD 與 GPS IFD 的 TIFF，抽查塗黑通過之後才寫回輸出的檔案：

- IFD1 的縮圖拿掉，那是遮蔽之前的原圖
- MakerNote、XMP、IPTC 與 Interoperability 拿掉，前兩者可能放著預覽圖
- 旋轉方向改成 1，瀏覽器解碼時已經把圖轉正

## 遮蔽的自動尋找

遮蔽畫面有「找人臉」與「找電話、Email 等個資」兩個按鈕，找到的範圍直接加成框，讀者逐一確認、點一下刪掉框錯的。自動尋找一定會漏，畫面上寫明，不自動套用（`src/ui/redact-detect.ts`）。

- 人臉：OpenCV 的 YuNet 模型（`public/models/yunet-2023mar-dynamic.onnx`，進版控，約 225 KB），用 onnxruntime-web 的 WebAssembly 執行，不需要 WebGL。官方模型的輸入固定 640×640，`scripts/make-yunet.py` 從官方檔案改成可變的輸入尺寸（權重不動，比對過 sha256）。整張圖縮到長邊 960 與 320 各偵測一次：960 抓合照裡的小臉，320 抓佔滿畫面的大臉（模型適合約 10 到 300 像素的臉）。縮小時每次最多縮一半，原始解析度的照片一口氣縮小會產生鋸齒，分數會掉。0.7 以上直接加成框，0.6 到 0.7 列為「可能是臉」，畫成黃色虛線，讀者點一下才變成遮蔽框，訊息區也有「全部加上」的按鈕。同一張臉在兩種尺寸都找到時只留分數最高的。解碼與合併在 `src/tools/redact/faces.ts`，有單元測試。實測 14 張照片，Chromium、WebKit、Firefox、Brave 都是 71 張臉全找到、零誤判，真臉最低 0.81，不是臉最高 0.55
- 個資：Tesseract 用正體中文與英文辨識文字，`src/tools/redact/pii.ts` 把同一行的字接起來比對電話、Email、身分證與居留證、卡號、長串數字、網址與 @帳號，再把對到的字合成一個框。「框起所有文字」把每一行文字都框起來，還沒辨識過時先辨識。照片裡的紋路與人影常被認成「| = ~ aa」這類碎片，所以只框信心分數夠高的字（`src/tools/redact/text-lines.ts`）：含字母、數字或漢字、85 分以上（4 個字元以上的長字 75 分），一段裡有兩個以上這樣的字，或一個 3 個字元以上的字，才算有文字
- Tesseract 的 WebAssembly 與語言資料由 `scripts/copy-vendor.mjs` 從 `node_modules` 複製到 `public/vendor/`（不進版控，`npm run build` 與 `npm run dev` 之前自動執行）。onnxruntime 的 WebAssembly 由 Vite 打包到 `assets/ort-wasm-*.wasm`（檔名帶雜湊）。都是按下按鈕時才下載，人臉約 14 MB（伺服器有壓縮時約 4 MB）、文字約 9 MB
- onnxruntime-web 只用單執行緒的 WebAssembly（`env.wasm.numThreads = 1`），多執行緒要伺服器另外送 cross-origin isolation 的標頭。升級前先在套件裡搜尋對外的網址，1.30.0 只在一段警告文字裡有說明頁的網址。先前用的 MediaPipe 1.0.0 起會把使用紀錄送到 `odml.pa.googleapis.com`，這種事要在升級時擋下來，不該靠 CSP
- Tesseract 的語言資料不寫進 IndexedDB（`cacheMethod: "none"`），靠瀏覽器的 HTTP 快取
- 處理中在圖片上蓋一層遮罩，中間顯示進度條：載入模型時不知道要多久，條紋來回移動，偵測時顯示百分比。按鈕下方的訊息區高度固定，所有可能出現的訊息疊在同一格、由最長的那一則撐開，換訊息時圖片不會跳動。人臉的進度依兩種尺寸的偵測推進，文字的進度取自 Tesseract 的 `logger`
- 授權與來源寫在 `licenses/redact-detect.txt`
- 網址帶 `?debug-faces`（例如 `/gears/redact/?debug-faces`）時，找人臉會在主控台印出建置的 commit 與每次偵測的尺寸、分數、位置與有沒有採用，讀者回報漏判、誤判時請對方整段貼回來。只有數字與座標，不含圖片的內容。不同的瀏覽器與照片的原始解析度會讓分數略有不同，本機重現不出來時靠它

## PDF 的遮蔽

遮蔽也接受 PDF（`src/ui/pdf-pages.ts`）。pdf.js 把每一頁畫成圖片，讀者一頁一頁框選，自動尋找也是對目前這一頁執行。套用時每一頁重新畫一次、塗黑、編碼成 JPEG，抽查框起來的點是黑的，再用 pdf-lib 組成一份新的 PDF，每一頁維持原本的大小。

- 輸出只有圖片，原檔的文字層、字型、文件資訊、XMP、附件、表單、註解與 JavaScript 都不帶過去。只在畫面上蓋一個黑框、文字還留在底下的 PDF 遮蔽很常見，複製或用 `pdftotext` 就讀得出來，這種做法不提供。代價是文字不能再選取與搜尋，檔案通常也會變大，畫面上寫明
- 沒有框的頁面也轉成圖片，隱藏的文字與其他頁的中繼資料一樣不會留下
- 編輯與輸出用同一個解析度（150 DPI，長邊最多 2400 像素），框的座標直接沿用。輸出時一次只畫一頁，長的文件也不會把每一頁的圖片同時放在記憶體裡
- `PDFDocument.create({ updateMetadata: false })`，不寫入 pdf-lib 預設的 Producer、Creator 與時間。寫完重新載入一次，頁數不對就放棄這次的結果
- pdf.js 的設定：`disableFontFace` 讓字形直接畫成路徑，CSP 的 `font-src` 不必放寬。`isImageDecoderSupported: false` 讓圖片一律用 pdf.js 自己的解碼器，Firefox 原本會先交給瀏覽器的 `ImageDecoder`，解不開的圖片在主控台留下 `Metadata decoding failed` 才退回。有開啟密碼的 PDF 直接失敗，畫面上請讀者先解除密碼。XFA 表單不處理
- pdf.js 會把傳入的陣列轉交給 worker、原本的陣列被清空，開檔時交一份複本
- CMap（中日韓字型的字碼對應，約 1.8 MB）、標準字型、JPEG 2000 與 JBIG2 的 WebAssembly 解碼器、CMYK 色彩描述檔由 `scripts/copy-vendor.mjs` 複製到 `public/vendor/pdfjs/`，只從自己的網域載入，用到時才下載。升級前一樣先在套件裡搜尋對外的網址，6.4.299 的 `pdf.min.mjs` 與 `pdf.worker.min.mjs` 裡只有命名空間與授權的網址。`wasm/quickjs-eval.*` 是執行 PDF 裡 JavaScript 用的，沒有開啟，不複製
- 換頁時，前一頁的圖片等新的一頁畫好、畫布換過去之後才釋放，先釋放的話，畫布重畫時用的是已經關閉的圖片，主控台會出現錯誤
- 授權全文在 `licenses/pdfjs.txt`

測試（`tests/e2e/redact-pdf.spec.ts`）用 pdf-lib 組出兩頁、有文字與作者的 PDF，遮蔽之後確認檔案裡沒有原本的文字、作者與字型，每一頁都是 JPEG，框起來的地方是黑的。中文字型在本機另外驗證過兩種：LibreOffice 轉出、內嵌 Noto Serif CJK 的 PDF，以及引用未內嵌字型 `MSung-Light`、編碼 `UniCNS-UCS2-H` 的 PDF（要靠 CMap），Chromium、WebKit、Firefox 都畫得出字，自動找個資也找得到電話與 Email。

## 縮成常見尺寸

清掉中繼資料之後，照片的原始解析度（例如 4032×3024）與相機的壓縮設定（量化表、色度取樣）仍然跟手機的機型有關（`src/tools/blend/`，畫面在 `src/ui/BlendEditor.tsx`）。讀者選長邊 2048、1600 或 1280 像素，等比縮小、用固定的 JPEG 品質 85 重新壓縮，這兩項就跟大多數人分享的照片一樣。另外做成一個工具、不併進清除中繼資料：縮小會降低畫質，要由讀者決定。

- 接受 JPEG、HEIC、AVIF、WebP。截圖（PNG）轉成 JPEG 會讓文字糊掉，不接受
- 每次最多縮一半，最後一步再縮到目標尺寸（`downscaleSteps`），一次縮小太多會產生鋸齒。比目標小的不放大，只重新壓縮
- 輸出一律是 JPEG，旋轉方向由解碼器套用在像素上，中繼資料不會帶過去
- 畫面上寫明限制：縮小能減少、不能消除感光元件的雜訊特徵（同一台相機的照片仍然可能被比對出來），畫面內容不會改變，Brave 會在輸出的像素加入防指紋的細微變化
- 讀不到 canvas（Tor Browser）時不輸出，接上 `canvas-access.ts`

## 列印文件的追蹤點

很多彩色雷射印表機在每一頁印上肉眼幾乎看不到的淡黃色小點，編著印表機的序號與列印的時間，紙本掃描或翻拍交出去時會跟著過去（`src/tools/print-dots/`，畫面在 `src/ui/PrintDotsEditor.tsx`）。接受照片與 PDF。

- 只看黃色：用「紅綠兩色比藍色亮多少」畫成灰階，黑色的字變成白色，淡黃色的小點變成看得到的深色圖案，讀者放大看是不是規則排列的小點。紙張本身常帶一點點黃，差距在 4 以內的當成白色
- 淡黃色的判斷（`isFaintYellow`）：紅綠都在 190 以上、藍色在 140 以上、紅綠比藍色亮 12 以上、紅綠相差不超過 40。螢光筆那種飽和的黃色藍色很暗，不算。淡黃色超過畫面的 15% 時比較可能是光線讓整張紙偏黃，畫面上改成建議轉黑白（`judge`）
- 去掉淡黃色：淡黃色的像素改成白色，其他顏色不動。轉成黑白：Otsu 法找門檻（限制在 100 到 200），淡黃色比門檻亮，一起變成白色。照片與彩色的圖會變成黑白，畫面上寫明
- 圖片轉黑白一律輸出 PNG，PNG、GIF、BMP 輸出 PNG，其他輸出 JPEG。重新編碼之後原檔的中繼資料一併拿掉
- PDF 沿用遮蔽的 `buildRedactedPdf`，`transform` 在每一頁畫成圖片之後處理像素，輸出只有圖片
- 不解碼點陣代表的序號與時間，那是追查文件來源用的。只處理黃色的點，黑白印表機與部分新型號用的是其他方式，畫面上寫明沒看到不代表沒有追蹤
- 讀不到 canvas（Tor Browser）時原圖照樣顯示，不判斷也不輸出，讀者允許之後按「只看黃色」或「套用」再讀一次
- 測試用 canvas 畫一張有黑字、螢光筆與每 16 像素一個淡黃點的頁面（`tests/e2e/print-dots.spec.ts`）

## 選擇 PDF 的頁面

只留下讀者勾選的頁面（`src/tools/pdf-pages/`，畫面在 `src/ui/PdfPagesEditor.tsx`）。用 pdf-lib 把選中的頁面複製到一份新的 PDF，頁面上的文字、圖片與註解保留原樣，文件資訊、XMP、書籤、附件、表單設定與結構標記掛在文件目錄上，不會帶過去。

pdf-lib 複製頁面時，頁面引用到的東西會一路複製過去，直接複製會把沒選的頁面帶進新檔：

- 連到其他頁的連結、跳頁動作、註解的 `/P` 與 `/IRT`、表單元件的 `/Parent`（欄位底下掛著其他頁的元件，外觀裡有填好的值），都會把另一頁整頁帶過來。複製之前在原檔裡拿掉這些參照：連結只留網址（`URI`），其他動作與頁面的 `/AA`、`/B` 一律拿掉，表單元件跟欄位脫鉤，不能再填寫，畫面上的內容照樣顯示
- 很多產生器讓所有頁面共用一份 `Resources`，裡面有只在別頁用到的圖片與字型。每一頁換成一份新的 `Resources`，只留這一頁的內容串流用到的名稱，沿用頁面資源的表單 XObject 裡用到的也算。內容串流解不開時停下來（`ToolError("unsupported")`），判斷不了用到哪些資源，就不交出可能帶著其他頁內容的檔案

複製之後從新檔的文件目錄走一遍，出現頁面樹以外的頁面就放棄這次的結果。還有一種擋不掉：Chromium、LibreOffice 這類產生器讓整份文件共用一組子集字型，字型裡的字形與字碼對照表（ToUnicode）含有每一頁用到的字，複製頁面時整組帶過去，其他頁用過哪些字（沒有順序與位置）就留在新檔裡。重新產生子集字型需要另外的函式庫，所以只偵測選中與拿掉的頁面有沒有共用字型，有的話在處理報告裡提醒，並提供「轉成圖片」的選項：沿用 PDF 遮蔽的 `buildRedactedPdf`，只畫選中的頁面，字型與文字層都不帶過去。

- 縮圖用 pdf.js 畫（長邊 240 像素），捲進畫面才畫，長的文件不會一打開就把每一頁都畫一次
- 縮圖太小看不清內容，每張縮圖有「放大」按鈕，用 `<dialog>` 顯示那一頁的大圖（長邊 2400 像素，預設依對話框寬度縮放），在對話框裡可以換頁、勾選，方向鍵也能換頁。手機的對話框只有三百多像素寬，另有「再放大」切換成兩倍寬（不超過畫出來的像素，也不比符合寬度小），左右捲動
- 處理報告的字串裡有 `{n}` 時（例如「沒有選的 {n} 頁」），`ReportView` 直接帶入數量，不另外附上「N 個範圍」
- 頁面上的作者這類中繼資料（頁面的 XMP、PieceInfo）跟著頁面過去，處理完再用清除中繼資料，畫面上寫明

單元測試（`tests/unit/pdf-pages.spec.ts`）組出三頁共用 `Resources`、各頁有自己的圖片、第一頁有各種連到第二頁的參照的 PDF，確認只留一頁時其他頁的字、圖片、表單的值、作者與書籤都不在新檔裡，也確認有其他沒清掉的參照時檢查會擋下。本機另外用 Chromium 列印的 PDF（頁內連結、書籤、結構標記、只在第二頁的圖片）驗證過，圖片沒有跟過去，共用字型的提醒也正確出現。

Tesseract 的 WebAssembly 會把執行紀錄寫到標準錯誤輸出，瀏覽器當成 `console.error`。瀏覽器測試的守門程式（`tests/e2e/guard.ts`）把這種已知的訊息列為例外。

## 查證

記者與公民團體收到檔案時，想知道裡面有哪些資訊可以用來驗證（`src/tools/verify/`，畫面在 `src/ui/VerifyTool.tsx`）。清除中繼資料讀的是同一批欄位，清除時當成風險，查證時當成線索。暫存區裡讀者加入的檔案算成一批，一律讀原檔（第一個版本），整理成一份查證紀錄：

- 檔案與雜湊值：格式、大小、加入暫存區的時間（`TrayFile.addedAt`）、SHA-256。用 `@noble/hashes` 一次讀 8 MB 分段計算，幾 GB 的影片也不必整個讀進記憶體，HTTP 頁面上也能用（`crypto.subtle` 只在 HTTPS 才有，而且不能分段）
- 時間線：所有檔案的時間排在一起，標出是哪一種時間、來源與時區。沒有時區的不猜，依字面排序，畫面上說明（`times.ts`）
- 裝置、序號、軟體、人名，同一個值出現在哪幾個檔案。位置只列座標，不畫地圖、不換算地址
- 編輯痕跡：照片內嵌的縮圖跟主圖並排、XMP 的編輯紀錄、Office 與 LibreOffice 的修訂次數與編輯時間、PDF 的數位簽章（只看簽章涵蓋到哪裡，不驗證憑證），以及 PDF 的版本紀錄（見下方）
- 需要留意的地方（`summary.ts`）：內容相同、副檔名跟格式不符、修改早於建立、拍攝時間跟 GPS 時間對不上（有時區時差 5 分鐘以上，沒有時區時差距不接近任何真實的時區）、記錄的軟體是影像編輯軟體、簽章之後還有加入內容、PDF 有舊版本

畫面的順序照讀者想問的（2026-10-16 首次試用時回饋全部攤開不好讀）：最上面一行總覽，接著是需要留意的地方，每一項是短標題加一句可能的原因。再來是每個檔案一張卡片，只列開始與最後修改的時間、裝置、軟體、人名、位置與其他痕跡，雜湊值、序號與所有的時間收在「完整資訊」裡。兩個以上的檔案才顯示檔案之間的關聯（出現在兩個以上檔案的值），合併的時間線預設收起來。沒有資料的區塊不顯示。檔案一律用檔名稱呼，不讓讀者在編號之間對照。匯出的紀錄用同一套說法（`src/ui/verify-report.ts`），技術資訊照樣全部寫出。

PDF 的版本紀錄：每一個 `%%EOF` 是一次存檔的結尾，切到那裡讀得出來就是一個版本，線性化的 PDF 第一個 `%%EOF` 不算。版本列在原檔的卡片裡（大小、頁數、時間），可以下載，不放進暫存區，免得看起來像另一份獨立的檔案。建立時間不會隨著修改改變，很多軟體修改 PDF 時也不會更新修改時間，所以各版本的時間常常相同，畫面上說明要用比對來看。比對兩個版本（`src/tools/verify/diff.ts`、`src/ui/pdf-compare.ts`）：

- 中繼資料：建立與修改時間、軟體、人名、頁數，有變的才列
- 文字：pdf.js 擷取每一頁的文字，同一個頁碼逐行比對（最長共同子序列），列出刪掉與加入的行
- 畫面：兩個版本都畫成長邊 1000 像素，以 8×8 像素為一格比對，一格裡有 3 個像素三色差距合計超過 60 才算不同（高過 Brave 讀 canvas 時加的雜訊），有差異的格子在兩張圖上都標成紅色。換掉的圖片、移動的簽名或印章沒有文字，靠這一項才看得到。超過 80 頁只比對文字
- 頁碼一對一比對，頁面順序被調換時會有好幾頁都顯示有差異，畫面上寫明

測試用的 PDF 由 `tests/helpers/pdf-incremental.ts` 照規格做成真正的增量更新（檔尾接上改過的物件、新的交互參照表與 `/Prev`），poppler 的 `pdfinfo`、`pdftotext` 讀得出兩個版本各自的內容。

只給線索，不下真假的判決：中繼資料很容易改，有矛盾不代表造假，沒有矛盾也不代表是真的，畫面與匯出的紀錄開頭都寫明。誤差分析與 AI 生成偵測的分數常被誤讀成判決，不做。也不提供填入假的中繼資料，假資料跟檔案的解析度、壓縮參數與內部結構對不上，比空白更顯眼。

查證紀錄可以下載成 Markdown，開頭是產生的時間（裝置的時鐘與時區）與建置的 commit，接著是雜湊值。也可以放進暫存區（來源記成 `verify`，查證只算讀者自己加入的檔案，所以不會算進這一批），接著用 age 加密。紀錄裡有從檔案讀出來的人名與位置，畫面上提醒讀者小心保管。

查證處理的是整個暫存區，在它的畫面加入檔案時留在原畫面（見「工具模組」的 `tray`）。

照片讀 EXIF（`extractExif` 支援的格式，`parseExif` 補上了拍攝、數位化、修改三種時間與各自的時區、GPS 的 UTC 時間與縮圖的位置），PDF 用 pdf-lib 讀文件資訊、XMP、簽章與舊版本，Office 讀 `docProps/core.xml` 與 `app.xml`，LibreOffice 讀 `meta.xml`，XMP 在其他格式裡用 `<x:xmpmeta` 搜尋。其他格式用加入暫存區時清除中繼資料的檢查結果，MP4、MOV、M4A 的時間是 UTC。單元測試在 `tests/unit/verify.spec.ts`。本機另外用 Pillow 寫入 EXIF 的照片、python-docx 產生的 Word 與 Chromium 列印的 PDF 驗證過。

## 面對面傳送

兩台裝置在同一個網路裡，用 WebRTC 直接傳暫存區的檔案，不經過任何伺服器（`src/ui/NearbyTool.tsx`）。規格與實測參考文件站的技術驗證（anoni-net/docs#553），程式是在 Gears 重寫的，沒有搬文件站實驗頁的程式碼（授權不同）。

- 連線描述（`src/tools/nearby/codec.ts`，有單元測試）：只開資料通道的 SDP 每次會變的只有 ICE 帳密、DTLS 指紋、候選與 setup 角色，只編這幾個欄位，約 90 到 110 位元組，接收端照固定樣板組回完整的 SDP。Chromium、Firefox、WebKit 互相接受彼此組回的描述（2026-10-17 兩兩互傳實測）。封包以 `GR` 開頭、版本 1，回應帶著對應的發起描述的標記，對不上的不套
- 候選只留 UDP 的 host，丟掉 loopback、link-local、CGNAT（`100.64.0.0/10`）與 Tailscale（`fd7a:115c:a1e0::/48`）。`iceServers` 是空的，不用 STUN 與 TURN，連線不會走到網際網路
- 配對：送出端的 QR code 是工作台的網址，連線描述放在 `#` 後面（不會送到伺服器），手機用系統相機掃就直接打開、自動回應，讀完就用 `history.replaceState` 從網址清掉。接收端的回應由送出端頁面裡的相機掃。沒有相機時複製貼上同一段代碼
- 先開相機、再建立連線描述：Chrome 與 Safari 取得相機權限之後才交出區網位址，只交 mDNS 名稱的話，網路不支援 mDNS 時兩邊都連不上（文件站的實機測試與 GitHub 的 CI 機器都遇過）。送出端本來就要開相機掃回應，接收端在工作台裡掃也是，至少一邊交出區網位址就連得上。接收端用系統相機打開網址時只交 mDNS 名稱，靠送出端的區網位址。Firefox 在無頭的假相機下仍然只交 mDNS 名稱，真的使用者允許相機之後如何還沒驗證，兩台都是 Firefox 又都沒有相機時要靠 mDNS。區網位址只交給面對面配對的對方，Tailscale 與 CGNAT 的位址濾掉
- 確認碼：兩邊的 DTLS 指紋排序後取 SHA-256，換成 6 位數字（`src/tools/nearby/protocol.ts`）。鏡頭對螢幕換不掉指紋，複製貼上可能經過別人的伺服器，要靠確認碼核對
- 傳輸（`src/ui/nearby.ts`）：一條有序、可靠的資料通道，先送檔案清單與每個檔案的 SHA-256，接收端的讀者按「接收」才開始傳，別人不能把檔案直接塞過來。64 KB 一塊，`bufferedAmount` 超過 4 MB 就等。接收端邊收邊算 SHA-256，對不上的不放進暫存區。檔名預設跟下載一樣改成 `gears-第幾個`，讀者可以勾選保留原本的檔名（傳給自己的其他裝置時）。接收端的檔案放在記憶體裡，合計上限先抓 1 GB
- 自己這一側一個可用的位址都沒有時（沒連上網路，或只剩被濾掉的位址），說明要先連上 Wi-Fi 或熱點
- 15 秒內連不上時說明公共 Wi-Fi 與訪客網路常擋裝置互連，建議開手機熱點。Tor Browser 把 WebRTC 整個關掉，onion 版說明並建議改用 OnionShare。傳送時用 Wake Lock 不讓螢幕關掉
- 瀏覽器測試（`tests/e2e/nearby.spec.ts`）在同一個瀏覽器開兩個分頁互傳，走複製貼上與「打開送出端的網址」兩條路。Firefox 不處理背景分頁的輸入，操作哪個分頁之前先 `bringToFront()`。CI 的機器沒有 mDNS 解析，Chromium 與 WebKit 給相機權限。GitHub 機器上的 Firefox 蒐集不到任何候選（2026-10-17 確認，位址隱藏關掉也一樣），測試先探測，蒐集不到就略過，所以 Firefox 的配對只在本機驗證。鏡頭掃 QR code 那一條跟 QR code 讀取共用解碼，沒有自動測試
- 還沒做的：文件站實測過多條並行連線能讓 iPhone 送出從每秒約 5 MB 提高到 37 MB，第一版只用一條連線。接收大檔案時 iPhone 的記憶體上限、切到背景與鎖屏之後連線是否還在，都要在實機上量

## QR code 的內容格式

產生器除了文字與網址，也做手機的相機認得的幾種格式，掃到之後會直接帶出動作（`src/tools/qrcode/index.ts`，畫面在 `src/ui/QrTool.tsx`）。寫法跟著 ZXing 的慣例走，Android 與 iOS 的相機都認得：

| 格式 | 內容 | 說明 |
|---|---|---|
| Wi-Fi | `WIFI:T:WPA;S:…;P:…;;` | 反斜線、分號、逗號、冒號與雙引號要跳脫 |
| 聯絡資料 | vCard 3.0 | 姓名整串放在 `N` 的姓氏欄，中文姓名不拆成姓與名。`URL` 是網址型別，逗號不跳脫 |
| 活動 | 單獨的 `VEVENT` | 時間不帶時區，掃描的手機當成它所在地的時間，畫面上寫明 |
| 位置 | `geo:緯度,經度` | 輸入欄接受地圖 App 複製的「緯度, 經度」，也讀得出地圖網址裡的 `@緯度,經度` |
| Email | `mailto:`，主旨與內容百分比編碼 | mailto 裡的加號是字面上的加號，不能當空白 |
| 電話 | `tel:` | 去掉空白、連字號、括號與點，剩下的只能是數字與 +、*、# |
| 簡訊 | `SMSTO:號碼:內容` | `sms:` 的內容參數各家寫法不一，SMSTO 兩邊都認得 |

- 欄位都放在同一份表單，切換格式時填過的內容留著（電話與簡訊共用號碼）。欄位不夠時顯示提示，格式不對時說明原因、不畫出 QR code
- 除了文字之外，預覽下方收著「QR code 裡的文字」，讀者可以確認實際放進去的內容。聯絡資料另外提醒印在名片或海報上時拍到的人都能存下，只填願意公開的欄位
- 下載的檔名依格式命名（`contact-qrcode.png`、`event-qrcode.png` 這類）
- 讀取端（`src/tools/qr-read/index.ts`，畫面在 `src/ui/QrContentView.tsx`）認得上表的格式，另外認得 MECARD、MATMSG、vCard 2.1 的 quoted-printable、`sms:`、包在 `VCALENDAR` 裡的活動（`TZID` 與 UTC 的時間照標示顯示）、兩步驟驗證的 `otpauth://`，以及 `bitcoin:`、`monero:`、`zcash:` 的付款網址。認得的格式拆成欄位，讀者在手機帶出動作之前先看清楚
- 有風險的格式在畫面上提醒：電話與簡訊可能是付費號碼，付款的 QR code 可能被貼上假的（按鈕改成複製地址），兩步驟驗證的金鑰拍到的人都能產生同一組驗證碼。金鑰本身不拆成欄位顯示，原文照樣列出
- 跟連線有關的格式（`src/tools/qr-read/network.ts`）：
    - Tor bridge：一行一個，torrc 的 `Bridge` 寫法與 `['…', '…']` 的清單寫法都認得。沒有傳輸方式的 bridge 要有 40 碼的指紋，否則任何「IP:連接埠」都會被當成 bridge。提醒公開張貼的 bridge 很快會被封鎖，按鈕改成複製 bridge
    - passkey 的跨裝置登入（`FIDO:/` 接一串數字）：提醒只掃自己正在登入的那台電腦上的，別人傳來的掃了等於讓對方登入。這是 passkey 的新型釣魚手法
    - VPN 與代理：WireGuard 的設定檔與 Shadowsocks、VMess、VLESS、Trojan、Hysteria 2、TUIC 的分享連結，只拆出伺服器與名稱，密碼、金鑰與 UUID 不顯示成欄位。提醒取得的人都能用這個帳號連線
    - 通訊軟體的邀請連結：Signal、Matrix、LINE、Telegram、WhatsApp、SimpleX 的加好友與加入群組連結，電話號碼的連結（`signal.me/#p/`、`wa.me/`）另外列出號碼。照樣可以交給網址檢查
- 付款的格式（`src/tools/qr-read/pay.ts`）：
    - 台灣 Pay 的共通 QR code（`TWQRP://服務名稱/158/交易類別/V1?…`）：財金公司沒有公開完整的規格，欄位依社群的逆向工程整理（例如 tzing 的〈TWQR 格式解析〉），只取意思確定的幾個：交易類別 01 掃碼付款、02 轉帳、03 繳費，`D1` 金額（以分計），`D5`、`D6` 轉入的銀行代碼與帳號，`D8` 商家，`D9` 附言，`D12` 有效期限。有的銀行把整串網址百分比編碼。只列欄位，不判斷真假
    - EMVCo 的商家付款碼（`000201` 開頭，PromptPay、PayNow、QRIS、VietQR、DuitNow 這類）：拆出付款網路、商家、城市、國家與金額，算 CRC-16/CCITT-FALSE 核對最後的 `63`，對不上時標出來。國家名稱交給 `Intl.DisplayNames`
- 條碼（`src/tools/qr-read/barcode.ts`）：
    - 登機證（IATA BCBP，多半印成 PDF417 或 Aztec）：姓名、訂位代號、航班、日期與座位。日期是一年中的第幾天，條碼沒有記年份，顯示時用今年換算。提醒有了訂位代號與姓氏就能登入航空公司的網站改行程，選用欄位（常客號碼這類）只說明有、不拆
    - 商品條碼（EAN-13、EAN-8、UPC、ISBN、ISSN）：只看條碼種類是 EAN、UPC 時才認，同樣的數字放在 QR code 裡只是文字。前三碼對到 GS1 的國家代號，說明那是廠商申請條碼的國家、不一定是產地。不連線查商品
    - 電子發票的一維條碼（Code 39，期別、發票號碼與隨機碼共 19 碼）
- 影像解碼（`src/ui/qr-scan.ts`）：先用 jsQR 讀 QR code，讀不到再交給 zxing-wasm 找其他條碼（`src/ui/zxing.ts`）。QR code 留給 jsQR，不需要 WebAssembly，鎖定模式照樣能讀。zxing-wasm 預設從 jsDelivr 下載 WebAssembly，`locateFile` 換成自己網域的 `assets/zxing_reader-*.wasm`（約 950 KB，壓縮後約 420 KB），升級前一樣在套件裡搜尋對外的網址。相機的畫面給 zxing 的是長邊 1600 像素，一維條碼要比較高的解析度
- 暫存區的圖片自動讀取時只找 QR code、PDF417、Aztec、Data Matrix、Code 128 與 Code 39（`PRIVATE_FORMATS`），登機證、票券與發票這類帶有個資的才列出來。商品條碼不找，照片裡常拍到包裝，列出一串商品編號沒有幫助
- WebAssembly 被關掉時（`wasmAvailable()`），讀取工具說明只能讀 QR code
- 範例：22 張 QR code 與條碼放在範例頁（見下方「範例」），依「分享前要遮住」、「打開之前先看清楚」、「不該外流的連線設定」、「日常」分組，點一下就用讀取工具打開（預設值 `sample:<id>`），走一般的解碼流程、不記使用統計，圖片也可以讓另一支手機的相機掃。內容與預期的格式寫在 `src/tools/qr-read/samples.json`，圖片由 `scripts/make-qr-samples.mjs` 在建置前（`prebuild`、`predev`）用 zxing-wasm 的完整版產生到 `public/samples/qr/`，不進版控。新增時三個語系要加 `qrread.sample.<id>`，`tests/unit/qr-formats.spec.ts` 檢查每張拆得出標示的格式，瀏覽器測試逐張打開一次
- 台灣的電子發票證明聯（`parseInvoice`）：照財政部《電子發票證明聯一維及二維條碼規格說明》Ver 1.9（2022-05-10）。左邊的 QR code 前 77 碼是字軌號碼、民國年月日、隨機碼、未稅與含稅金額（十六進位）、買方與賣方的統一編號與加密驗證，之後以冒號接著品目筆數、中文編碼參數（0 Big5、1 UTF-8、2 Base64、3 境外電商）與「品名:數量:單價」，放不下的接在右邊以 `**` 開頭的 QR code。兩個 QR code 各自讀，左邊列出發票的欄位與讀得到的品項，品項沒讀完時說明其他的在右邊。境外電商的金額是 8 碼整數加 2 碼小數，可能是外幣，不加單位。畫面上提醒發票的 QR code 帶著金額、店家與買了什麼，打了統編時還有買方的統一編號，分享收據的照片前可以先遮蔽
- Big5 的內容：jsQR 用 `decodeURIComponent` 解開位元組，不是 UTF-8 的那一段會變成空字串，Big5 的電子發票整個讀成空的。`qrText` 發現有位元組沒解出文字時，先用 UTF-8 解整串位元組，不是的話當成 Big5（`TextDecoder("big5")`，三種瀏覽器核心都支援）
- 格式清單在 `src/tools/qrcode/formats.ts`，產生器、讀取與使用統計共用。跟 `QrContent` 的 `kind` 對不上時型別檢查會失敗
- 單元測試（`tests/unit/qrcode.spec.ts`、`tests/unit/qr-read.spec.ts`、`tests/unit/qr-formats.spec.ts`）把每一種格式產生的 QR code 解碼回文字比對，再交給讀取端拆回欄位。電子發票用規格說明的範例，Big5 的那一份由 `tests/helpers/qr-decode.ts` 的 `encodeBytes` 直接把位元組放進 QR code。條碼的測試圖片由 `tests/helpers/barcodes.ts` 用 zxing-wasm 的完整版（含產生條碼）在 Node 裡產生，網頁只載入讀取的那一半

## 影片的關鍵影格

收到影片要查證時，常見的做法是擷取幾個畫面做反向圖片搜尋，找出影片原本的出處，現有的線上工具多半要先上傳影片。這裡在瀏覽器裡挑出畫面明顯不同的幾格，讀者勾選之後加進暫存區（檔名 `frame-1-05.3.jpg`，不沿用影片的檔名），用哪個搜尋服務由讀者決定，工作台不連到任何服務。畫面上提醒反向圖片搜尋要把圖片上傳給該服務，有人臉或個資時先遮蔽。純邏輯在 `src/tools/video-frames/`（有單元測試），擷取在 `src/ui/video-frames.ts`，畫面在 `src/ui/VideoFramesEditor.tsx`。

- 不用影片檔裡標記的 I 影格：編碼器多半每一兩秒放一格，跟畫面有沒有換沒有關係。改成比對畫面：最多取樣 240 個時間點（間隔至少 0.5 秒），每個時間點畫成 32 × 32 的灰階，跟上一格留下的畫面平均差 24 以上才留，慢慢移動的鏡頭累積夠多也會留一格。單一顏色的畫面（黑幕、淡入淡出）略過。超過 16 格時留差距最大的。只找到一格時（畫面幾乎不動）平均補到 4 格，找到兩格以上就不補，補進來的會是同一個場景的重複畫面
- 挑法是比對整張畫面的平均變化，適合剪輯過、會換鏡頭的影片。監視器這類背景不動、只有一小塊在變的影片，有動靜的那一段常常挑不到（一個人占畫面一成走過，平均差距只有 8 左右），晃動很大的手機影片則會從同一個場景挑出好幾格。畫面上收在「適合哪些影片」裡說明（`frames.when.*`），平均補格時（`pickFrames` 的 `evenly`）另外說明這幾格是平均挑的。要支援監視器畫面需要另一種判斷方式（背景比對、分區塊、密集抽樣），跟找出處的用途不同，還沒有做
- 用瀏覽器的 `<video>` 解碼，從 Blob 的網址讀，幾 GB 的影片也不必整個讀進記憶體（`acceptsLarge`）。擷取的畫面長邊最多 1920 像素，重新編碼成 JPEG，不帶任何中繼資料
- 跳轉之後用 `requestVideoFrameCallback` 等新的畫面出來才畫（最多 0.5 秒）。Firefox 偶爾在 `seeked` 之後畫出來的還是上一格，整個場景會被漏掉，擷取的畫面也跟標示的時間對不上
- MediaRecorder 錄的 WebM（瀏覽器的螢幕錄影常是這種）沒有索引，Firefox 跳轉之後畫面不會更新，取樣到的全是第一格。取樣的畫面幾乎都一樣時，改成以 16 倍速從頭播放、依序取樣，挑出來的畫面也一樣播放擷取。畫面真的不動的影片也會走到這裡，所以只在 2 秒到 30 分鐘的影片這樣做。播放 15 秒都沒有前進就當成播不了
- 瀏覽器播不了的格式（AVI、Firefox 的 HEVC）畫面上說明，建議轉成 MP4（H.264）
- 要讀 canvas 的像素，Tor Browser 讀不到時說明，讀者按「再試一次」時在點擊的當下讀一次，網址列才會跳出詢問
- 測試影片不進 repo：`tests/global-setup.ts` 有 ffmpeg 時產生紅、綠、藍三個場景的 H.264 MP4 與 VP8 WebM，另外在頁面裡用 MediaRecorder 錄一段沒有索引的 WebM。Linux 版的 WebKit 少了 GStreamer 的外掛時，跳轉正常、畫到 canvas 卻全是黑的，`canPlayType` 也照樣回報可以，所以測試先實際畫一格確認，畫不出來就略過。iPhone 與 Safari 上的擷取要在實機確認

## 文件開啟前檢查

有些 Word 與 PDF 被做成一打開就連到外面（遠端範本、外部圖片、打開時執行的動作），寄件的人就知道誰在什麼時候、從哪個 IP 打開。記者與公民團體收到不明來源的文件時最需要先確認這件事（`src/tools/doc-check/`，畫面在 `src/ui/DocCheckEditor.tsx`）。只讀檔案的結構，不打開、不執行、不連線，列出的是檔案裡寫了什麼。

| 格式 | 打開時會連線 | 會執行的程式 | 內嵌 |
|---|---|---|---|
| Word、Excel、PowerPoint（含有巨集的 docm、xlsm、pptm） | 外部關聯（`TargetMode="External"`）的遠端範本、圖片、頁框、物件、外部連結與合併列印來源，`INCLUDEPICTURE`、`INCLUDETEXT`、`LINK` 欄位裡的網址（指令拆成好幾段 `instrText` 時接起來判斷），Excel 的網頁查詢與資料庫連線 | `vbaProject.bin`、ActiveX、DDE 欄位 | `embeddings/` |
| LibreOffice | 連結的圖片、物件、表格與章節來源 | `Basic/`、`Scripts/`、綁在文件事件上的巨集，DDE | `Object N/` |
| PDF | 打開時執行的動作（`OpenAction`、文件與頁面的 `AA`、註解在頁面打開或看得到時的觸發）裡的網址、送出表單與遠端檔案，打開時執行的 JavaScript 裡的網址 | JavaScript（文件層級的名稱樹、各種動作，以及沒有被引用、但檔案裡還有的）、開啟其他程式（`Launch`）、XFA 表單 | 附件（`EmbeddedFiles`、檔案附件註解）、多媒體 |
| HTML、SVG | 外部的圖片、頁框、樣式、字型、CSS 的 `url()` | `script`、`on*` 屬性 | |

- 連結（點了才會連）另外收在可以展開的清單，依網域分組（`groupByHost`，主機名稱小寫、拿掉開頭的 `www.`），網域依出現次數排序，展開看完整網址與各自的次數。同一個連結在文件裡出現好幾次時只列一次、記下次數（`CheckItem.count`）。網路芳鄰路徑（`\\主機\分享`）另外提醒：Windows 連過去時會自動送出帳號名稱與密碼的雜湊值
- PDF 可以轉成安全的 PDF：沿用遮蔽的 `buildRedactedPdf`，每一頁畫成圖片再組回去，做法跟 Dangerzone 相同，原檔的程式、連結、表單與內嵌的檔案都不會留下。Office 文件要轉成圖片需要 LibreOffice 的 WebAssembly 版，體積很大，先只寫說明（保護檢視、不要按啟用內容、離線打開或用 Dangerzone）
- 有巨集的 Office 文件判斷成 `docm`、`xlsm`、`pptm`（`src/core/documents.ts`），清除中繼資料不接受，只清外殼、巨集原樣留著不妥
- 畫面上寫明「沒有找到不等於一定安全」：實際的行為要看打開的軟體與設定，程式也可能用認不出的方式連線
- 其他地方連過來：信件檢查與查證的附件、查證的檔案卡片遇到可以檢查的文件時，有「開啟前檢查」的按鈕（`src/ui/doc-check-link.ts`，附件先加進暫存區，再把網址換成 `/gears/doc-check/`）。查證也會執行一次檢查，打開時會連線或含有程式的文件列在需要留意的地方（`doc-connects`、`doc-code`）
- 信件 HTML 內文顯示時會載入的外部圖片與樣式（常是追蹤用的 1×1 圖片）用同一套 HTML 的判斷找出來（`remoteResources`），信件檢查另外列一區、加上提醒，不算進信裡的連結，查證也列在需要留意的地方（`email-remote-content`）
- 測試用的文件與信在 `tests/helpers/tracked-docs.ts`，網域用 `example.*`

## 信件檢查與信件的查證

收到可疑的信時，讀者貼上原始郵件（Gmail 的「顯示原始郵件」、Outlook 的「檢視郵件來源」）或開啟 .eml 檔，看這封信實際上從哪裡寄來（`src/ui/EmailTool.tsx`）。查證也讀 .eml，兩邊共用 `src/tools/email/` 的解析與判斷。一般讀者只想知道這封信是不是真的，查證要的是時間線、附件與紀錄，所以做成兩個入口。

- 解析（`parse.ts`）：標頭展開折行、解開 `=?UTF-8?B?…?=` 與直接寫 UTF-8 的標頭、地址、Date 與每一站 Received 的時間與 IP、Authentication-Results 與 ARC 的結果、DKIM 簽章的網域，內文的 MIME 一層一層拆開，取出附件（RFC 2231 的檔名）與連結。mbox 開頭的 `From ` 行略過。暫存區用 `src/core/email-sniff.ts` 從開頭的標頭判斷格式（`eml`）
- 寄件驗證（`assess.ts`）只看收件伺服器記在信裡的 SPF、DKIM、DMARC，不自己查 DNS，頁面不連網。只採信最上面那一筆 Authentication-Results（收件的伺服器寫的），下面自稱通過的可能是寄件的人自己寫的。DMARC 有結果就照它，沒有時看 SPF 或 DKIM 有沒有跟寄件網域對齊（同一個註冊網域）地通過
- 驗證通過只代表信確實來自那個網域，畫面上提醒看看網域是不是預期的那一個，並沿用網址檢查的相似品牌判斷與 165 清單（`src/ui/scam-list-loader.ts`，兩個工具共用）
- 需要留意的地方：回覆地址換成別的網域、顯示名稱裡藏著另一個信箱、寄出時間跟第一站收到的時間差一天以上、會執行程式或常拿來釣魚的附件（.exe、.html、.docm 這類）。退信地址是別的網域只當成說明，電子報常這樣做
- 信裡的連結列出實際的網址，按「檢查這個網址」用預設值打開網址檢查。附件可以加入暫存區（當成讀者的原檔，查證時算進同一批），只讀取，不開啟、不執行
- 時區寫成 `CST` 的不當成美國中部時間：台灣與中國的伺服器常用它表示 +08:00，有歧義，當成沒有時區
- 查證裡的 .eml：寄出與每一站收到的時間進時間線，寄件人、回覆地址、收件人進人名，寄件驗證沒有通過與上面的提醒併進需要留意的地方，附件可以「一起查證」

測試用的信在 `tests/helpers/emails.ts`，網域用 `example.*`、IP 用保留給文件的位址。本機另外用 Python 的 `email` 套件產生的信驗證過折行的中文主旨、兩層 multipart、直接寫 UTF-8 的內文與中文附件檔名。

## 下載的軟體驗證

讀者選下載的檔案與旁邊的簽章檔（`.asc`、`.sig`），用內建的官方公鑰驗證 OpenPGP 的分離式簽章，確認檔案是官方簽署、下載之後沒有被改過的（`src/tools/software-verify/`，畫面在 `src/ui/SoftwareVerifyTool.tsx`）。不必安裝 GnuPG、不必輸入指令。第一版只有 Tor Browser 與 Tails。

- 檔案用串流讀（`Blob.stream()` 交給 openpgp.js），幾 GB 的 Tails 映像檔也不必整個讀進記憶體，同時算出 SHA-256。檔案不放進暫存區，安裝檔只需要讀一次
- 結果分四種：簽章正確、檔案跟簽章對不上（不要安裝）、不是內建的金鑰簽的、讀不出簽章。簽章檔的名稱不是檔名加上 `.asc` 或 `.sig` 時另外提醒可能選錯了。一次選兩個檔案時，依開頭判斷哪一個是簽章檔
- openpgp.js 依簽章的建立時間檢查金鑰，子金鑰之後到期，到期前簽的檔案照樣驗得過，撤銷的子金鑰驗不過
- openpgp.js 透過 `src/tools/software-verify/openpgp.ts` 動態載入，打包成獨立的 `openpgp-*.js`（LGPL 要求可以換成自行編譯的版本），授權全文在 `licenses/openpgp.txt`。6.3.2 裡只有預設的 armor 註解有 `openpgpjs.org` 的網址，沒有對外連線
- 公鑰在 `src/tools/software-verify/keys.ts`，由 `node scripts/signing-keys.mjs` 從官方的來源下載，比對主金鑰的指紋（寫在 `SIGNERS`，取自官方說明頁），拿掉其他人的認證簽章再寫回，同時列出每把子金鑰的效期。`--check` 只比對，跟 `keys.ts` 不同時以非零值結束
- 每月跟著文件站的例行查證核對一次：執行 `node scripts/signing-keys.mjs --check`，有變就更新、開 PR，並看一下有沒有快到期的子金鑰。官方換主金鑰時腳本會停下來，要先讀過公告再手動改 `SIGNERS` 的指紋
- 測試用官方真正的簽章（`tests/helpers/signed/`）：Tor Browser 15.0.25 的 `sha256sums-signed-build.txt` 與簽章，以及 Tails 7.14 映像檔的簽章（只確認簽署的子金鑰在內建的公鑰裡）

## 寫作習慣檢查

匿名交出的文字常因為寫作習慣被認出是誰寫的（`src/ui/WritingStyleTool.tsx`，規則在 `src/tools/writing-style/`）。讀者貼上文字，畫面標出會透露身分的習慣，標點與符號可以一鍵修正，其他的列出建議，由讀者自己改。只用固定的規則，結果每次都一樣，不會改到內容的意思，也不必下載模型，手機與離線都能用。文字只在記憶體裡，不送出也不存下來。

- 可以直接修正（`FIXABLE`）：表情符號與顏文字、笑聲（哈哈哈、XD、www）、誇張的標點（!!!、~~、...）、中文句子裡的半形標點、"" 與 “” 換成「」、全形英數、排版（段首空格、用空格斷句、連續空行）。只動標點、空白與符號。刪掉表情符號時兩邊都是文字就補一個逗號，避免兩句接成一句。修正一次可能讓另一個習慣浮出來，最多重做三次
- 需要讀者自己改：句尾語助詞與句首發語詞（啦、喔、欸）、口頭禪（`老實說`、`說真的`，以及用到三次以上的 `其實`、`然後`）、中英夾雜（常見的詞附上中文說法，單一個字母不算）、中國用語與粵語用字（附上台灣書面語的說法）、注音文、個資（電話、Email、身分證字號，規則與遮蔽的自動尋找共用 `findPiiInText`）
- 有建議寫法的項目（語助詞、口頭禪、附了中文說法的英文詞、中國用語、粵語用字）可以逐項套用，同樣的寫法出現好幾次時一起改，一組裡有兩種以上的寫法時可以整組套用（`applyHabits`）。只改讀者選的那幾處，換上中文時拿掉夾在中文之間的空白。沒有一次全部套用的按鈕，每一處修改都由讀者按下，修正與套用可以一步一步復原。用到三次的「其實」、注音文、個資沒有建議寫法，只標出來 <!-- docs-style-lint: disable-line -->
- 基準是台灣正體中文的書面語：中國用語與粵語用字標出來，台灣用語不標。地區用語只收意思不會混淆的，「程序」、「項目」、「支持」在台灣也用，不收
- 比對的順序有意義，前面的先佔位，重疊的後者不算，例如網址裡的英文不算中英夾雜、ㄏㄏ算注音文
- 畫面最下面寫明改變寫作風格不會拿掉內容透露的線索（只有作者知道的細節、時間、職位與單位）
- `facts.ts` 的 `missingFacts` 比對改寫前後的數字（中文數字換成阿拉伯數字再比）、引號裡的原話與個資，給之後用語言模型改寫時檢查有沒有改掉事實。`addedNumbers` 反過來列出改寫後多出、原文沒有的數字，研究裡 Qwen3 4B 把「大概二十幾家分店」寫成「約二十三家」，捏造的精確數字跟少了數字一樣危險。原文那一邊放寬認定，冠詞的「一個」、列舉的「一、」與序數的「第三」都算，改寫成阿拉伯數字時不會被標出來。社群工作區的 `research/gears-llm/` 用同一套規則評測模型，規則改了評測的數字也會跟著變

## 語言模型速度量測（實驗頁）

`/gears/llm-bench/`（`src/ui/LlmBench.tsx`，Worker 是 `src/ui/llm-bench.worker.ts`）在讀者的瀏覽器裡執行小型語言模型，改寫範例文字，量測載入時間、第一個字出現的時間與每秒的詞元數，也用寫作習慣檢查的規則看改寫有沒有少了數字或引述。給社群評估寫作風格的第二層（用語言模型改寫，研究在社群工作區的 `research/gears-llm/`）用，結論是還不能上線，這一頁讓維護者在不同的裝置上持續量測。

- 實驗頁的清單是 `src/pages.ts` 的 `labIds`：桌面不放入口，只從頁尾連過去，不進 sitemap，頁面帶 `<meta name="robots" content="noindex">`
- 模型在 `src/tools/llm-bench/models.json`，從 Hugging Face 下載，鎖定 commit，伺服器送的 CSP 只開這幾個下載路徑（跟 large-v3-turbo 一樣）。Transformers.js 有幾處讀檔沒有把 `revision` 傳下去，Worker 直接把 `env.remotePathTemplate` 鎖在這個 commit。畫面上說明 Hugging Face 看得到 IP 位址、瀏覽器與下載了哪個模型
- Qwen3 1.7B 改用社群轉檔的版本（`host` 是 `assets`），從 assets.anoni.net 的 `qwen3-1.7b-3231b52/` 下載。onnx-community 的顯示卡版把權重包在單一個 1.43 GB 的 `.onnx` 檔，瀏覽器裡建立推論環境時記憶體不夠（`std::bad_alloc`，2026-10-18 在 Apple M5 Pro 的 Chromium 實測），其他模型都把權重放在另外的 `.onnx_data` 檔。轉檔只把權重改存成外部檔案，權重與計算都沒有修改，外部權重檔再用 `scripts/split-model.mjs` 切成 400 MB 一段，轉檔的做法與實測數字見社群工作區的 `research/gears-llm/02-browser-gpu.md`。Worker 的 `env.fetch` 只下載 `files` 清單上的檔案、比對 SHA-256，切段的檔案沿用逐字稿的 `joinParts`，CSP 不必另外開（assets.anoni.net 的模型目錄已經開了），也不再開這個模型在 Hugging Face 的路徑
- 下載的檔案存在 Transformers.js 自己的快取（`transformers-cache`），頁面上可以刪掉。`useWasmCache` 關掉：存了之後 onnxruntime 的載入程式改用 `blob:` 網址載入，CSP 不允許
- 下載進度由 `env.fetch` 自己計算，不傳 `progress_callback`（理由同逐字稿）
- 瀏覽器裡用 CPU 只有 Qwen3 0.6B 能用（改寫品質不夠，只當 CPU 速度的參考，沒有顯示卡時預設選它）。Qwen3 1.7B 的 4 位元版是單一個 2.15 GB 的檔案，超過瀏覽器能建立的 ArrayBuffer 上限，8 位元版建立推論環境時記憶體不夠（`std::bad_alloc`，WebAssembly 最多 4 GB，還要複製一份模型）。Qwen3.5 的每一種量化版本都用到 WebAssembly 沒有實作的 `GatherBlockQuantized`（Node 的 onnxruntime 有）。Qwen3 4B 只有顯示卡版。顯示卡版的 Qwen3.5 0.8B 在 Chromium 的軟體模擬顯示卡上可以建立並完成改寫
- 有顯示卡時預設選 Qwen3 1.7B（社群轉檔的版本，見上方）。2026-10-18 在 Apple M5 Pro 實測，每秒的詞元數 Chromium 約 93、Safari 約 67，Qwen3 4B 是 50 與 37，下載量也是 1.7B 小一半。社群轉檔上線之前曾暫時預設選 4B（#93）。實測數字見社群工作區的 `research/gears-llm/02-browser-gpu.md`
- 提示（`prompt.ts`）只給 Worker 用，範例文字（`samples.ts`）只給頁面用，兩邊不共用模組。提示與研究的 `eval/run.mjs` 相同，數字可以跟研究報告對照
- 「數字與引述的變化」一欄列出改寫後少掉（`missingFacts`）與多出（`addedNumbers`）的數字與引述
- 量測中不出現換版本的提示（`useWorking`）。「複製結果」把裝置資訊與每一段的時間、改寫結果寫成 JSON

## 逐字稿

把錄音或影片的聲音轉成帶時間的段落，支援華語、台語、粵語與多種亞洲語言（`src/ui/TranscribeEditor.tsx`，語言與模型見下方）。結果不是錄音的新版本，TXT 與 SRT 另外放進暫存區，也可以直接下載或複製。逐字稿是草稿，畫面上寫明要對照錄音校對。

- 模型：Whisper small（252 MB，預設）與 base（80 MB），onnx-community 的 8 位元量化版，另外可以選從 Hugging Face 下載的 large-v3-turbo，以及社群轉檔、放在 assets.anoni.net 的三個模型（見下方），讀者自己選。tiny 對華語幾乎不能用（實測字錯率 98%，會掉進英文的重複迴圈），不提供。用魯迅〈阿Q正傳〉的 LibriVox 朗讀實測字錯率：small 約 24%、base 約 56%
- 模型不進版控，`node scripts/fetch-whisper.mjs` 從 Hugging Face 下載到 `public/models/whisper/`（CPU 與 WebGPU 兩組，CI 加 `--no-webgpu` 只下載 CPU 用的），版本與每個檔案的 SHA-256 寫在 `src/tools/transcribe/models.json`。部署前先執行一次，網頁只從自己的網域載入
- 模型從哪裡下載寫在 `models.json` 的 `host`：`self` 是工作台自己的網域（service worker 快取），`hf` 是 Hugging Face，`assets` 是 assets.anoni.net。後兩種由 Worker 下載、比對 SHA-256、存進快取（`src/tools/transcribe/remote.ts`）
- large-v3-turbo（4 位元量化版，約 760 MB）從 m6 送出的流量太重，`host` 是 `hf`，讀者選擇之後由網頁直接從 Hugging Face 下載（`src/tools/transcribe/remote.ts`）。選了還沒下載的大模型時，畫面先說明 Hugging Face 看得到 IP 位址、瀏覽器與下載了哪個模型，按鈕寫成「從 Hugging Face 下載並開始」。網址鎖定 commit，每個檔案讀完比對 SHA-256，對不上就不存。請求不帶 cookie 與 Referer。下載好的檔案存進同一個 `gears-models` 快取，網址用自己網域的路徑，「已下載」與刪除跟 small、base 一樣處理。Transformers.js 會把 `env.fetch` 的錯誤換成「找不到檔案」，Worker 另外記下下載失敗的原因
- 用同一段朗讀實測（Node），large-v3-turbo 的字錯率約 22%，small 約 28%，辨識時間約 small 的 1.7 倍。q8 版的字錯率相近、檔案大 300 多 MB，所以用 q4
- 社群轉檔的模型（`host` 是 `assets`）：泰語的 distill-whisper-th-small（MIT）、台灣華語與中英夾雜的 Breeze-ASR-25、台語的 Breeze-ASR-26（Apache-2.0）。用 Transformers.js 3.8.1 的轉檔腳本匯出、量化，q4 改用非對稱量化（對稱的泰語模型在兩段陷入重複迴圈），轉檔的做法與實測記錄在社群的工作區。放在 m6 的 `/srv/images-anoni-net/gears/models/<模型目錄>/`，網址是 `https://assets.anoni.net/gears/models/<模型目錄>/`，目錄名稱帶著原始模型的 commit，內容不會變，每個目錄附 `README.txt`（來源、授權、轉檔方式）與授權全文。超過 500 MB 的檔案切段後只上傳切好的段。nginx 已經送出 `Access-Control-Allow-Origin: *`
- 緬甸語、高棉語、寮語、孟加拉語、尼泊爾語、蒙古語用 Meta 的 Omnilingual ASR CTC 300M（Apache-2.0，365 MB），Whisper 在這些語言錯誤率接近或超過 100%。Transformers.js 不支援這個架構，改用 sherpa-onnx 的 WebAssembly 在另一個 Worker 執行（`src/ui/sherpa.worker.ts`，訊息格式跟 `transcribe.worker.ts` 相同，畫面依 `models.json` 的 `engine` 決定開哪一個）。模型是 sherpa-onnx 轉檔版，放在 assets.anoni.net。實測 FLEURS 字錯率：緬甸 14.2%、高棉 14.6%、寮 23.7%、孟加拉 8.2%、尼泊爾 11.4%、蒙古 15.7%，瀏覽器裡單執行緒的辨識時間約錄音長度的 0.7 倍。CTC 模型沒有段落時間，語音偵測切出的一個片段就是一段，輸出沒有標點
- sherpa-onnx 的 WebAssembly 是社群自己建置的 ES module 版（官方的 glue 不是 ES module，在 module Worker 裡沒辦法用 `import()` 載入，也傳不進設定），放在 `https://assets.anoni.net/gears/vendor/sherpa-onnx-1.13.8-es6/`，建置方式、patch 與授權在那個目錄的 `README.txt`。`node scripts/fetch-whisper.mjs` 依 `src/tools/transcribe/sherpa-runtime.json` 下載到 `public/vendor/sherpa/` 並比對 SHA-256，網頁從自己的網域用 `import()` 載入，CSP 不必改（只用到 `'wasm-unsafe-eval'`）。模型寫進 Emscripten 的檔案系統建立辨識器之後刪掉。只能用 1 個核心、不能用顯示卡，也還不能分辨說話者，畫面上藏起這三個選項、改成說明
- 研究時也比較過 Dolphin（sherpa 版只用 CTC，比論文差很多，寮語會輸出泰文字母）、Qwen3-ASR 0.6B（粵語好，但多 1 GB、記憶體幾乎用滿）。烏爾都語 Omnilingual 會寫成天城文，客語兩個模型都不能用，這兩種語言沒有放
- 實測（Node，CPU）：泰語模型在 FLEURS 泰語的字錯率 12.4%（large-v3-turbo 17.0%）。Breeze-ASR-26 把台語轉成華語文字，教育部台語例句對華語翻譯的字錯率 39%（turbo 65%）。Breeze-ASR-25 在〈阿Q正傳〉18%（turbo 22%），中英夾雜 14%（turbo 17.5%）。兩個 Breeze 是 large-v2，解碼器 32 層，在 CPU 上辨識時間約錄音長度的 2 到 3.5 倍
- CSP：伺服器送的標頭多開 `https://huggingface.co/<repo>/resolve/<commit>/`（只有下載的路徑，不含上傳用的 API）、`https://*.hf.co`（下載會轉址到 CDN，轉址之後 CSP 只比對主機）與 `https://assets.anoni.net/gears/models/`。頁面同時有標頭與 meta 標籤時兩者都要符合，所以頁面本身仍然只能連自己的網域，只有 Worker 連得到這兩個地方。瀏覽器測試攔下兩邊的請求，回一份內容不對的檔案，確認會停下來、不存進快取
- 推論在 Web Worker（`src/ui/transcribe.worker.ts`）用 Transformers.js 執行。關掉 Hugging Face 的下載（`allowRemoteModels`）與 Transformers.js 自己的快取（`useBrowserCache`、`useWasmCache`），請求不寫 HTTP 快取（`cache: "no-store"`，模型檔最大 157 MB，無痕視窗的記憶體快取寫不下時整個請求會失敗）
- Transformers.js 帶著自己的 onnxruntime-web（1.31.0 的開發版，跟找人臉的 1.30.0 分開），不指定的話會從 jsDelivr 的 CDN 載入 WebAssembly。Worker 不受頁面 meta 標籤的 CSP 約束，請求真的會送出去，所以用 `?url` 匯入它那一份 WebAssembly，從自己的網域載入。預覽伺服器也用標頭送 CSP，部署時 nginx 一樣要送（見下方「部署」）
- 語音偵測：Whisper 在靜音上會產生重複的幻覺文字（實測 base 對 5 秒的靜音輸出「你懂你懂……」直到長度上限）。先用音量找出說話的段落，裝成不超過 30 秒的片段（裝得下就連同停頓放在一起，Whisper 不管片段多短都補到 30 秒再算），只把這些片段送進模型。每個片段依長度限制最多產生的詞元數。整理結果時拿掉靜音段落、短短一段的字幕標語（「字幕製作」、「請不吝點讚」這類），收掉重複的迴圈（`src/tools/transcribe/segments.ts`，有單元測試）
- 語言由讀者選（`src/tools/transcribe/languages.ts`）：華語、台語、粵語、英語、日語、韓語、越南語、泰語、印尼語、馬來語、菲律賓語、緬甸語、高棉語、寮語、孟加拉語、尼泊爾語、蒙古語。畫面先選語言，再列出這個語言能用的模型（`models.json` 的 `languages`），泰語預設用泰語模型、台語只有 Breeze-ASR-26，其他語言預設 small。台語傳給 Whisper 的語言代碼是 `zh`。粵語在 Transformers.js 沒有語言代碼，只列 large-v3-turbo、指定 `zh`，輸出書面中文（FLEURS 粵語字錯率 8.8%，不指定語言時會翻成英文），口語用字可能被改寫成書面語，畫面上說明。換語言時回到這個語言預設的模型。Transformers.js 4.3.1 沒有實作 Whisper 的語言偵測，不指定語言時一律當成英文，華語的錄音會直接翻成英文（原本的「自動判斷」就是這樣壞掉的）。粵語在 Transformers.js 沒有語言代碼，等另外的模型
- 簡體轉台灣正體與台灣慣用詞：`opencc-js` 的 `cn2t`（cn → twp），在 Worker 裡用到時才載入。只在選華語、台語、粵語時轉，半形標點換成全形也是。粵語用香港的字形（裏、着、麪，`chineseVariant`），日文的漢字與其他語言的標點不動。Breeze 本來就輸出正體字（`models.json` 的 `traditional`），不再轉
- 同時使用的 CPU 核心讀者自己選（1、2、4、8、12、16），預設值依瀏覽器回報的核心數決定（`src/tools/transcribe/threads.ts`，有單元測試）。多執行緒要頁面在 cross-origin isolation 底下（COOP 與 COEP 標頭），換核心數時換一個新的 Worker（onnxruntime 第一次載入時就決定了執行緒數）。實測差距很大：15 核心的 MacBook Pro 上，同一段錄音 4 個核心要 40 分鐘、8 個 8 分鐘、12 個 4 分鐘（這台開發機在其他程式同時執行、負載很高時量到的差距小很多，不準）。`navigator.hardwareConcurrency` 只會比實際少：Brave 回報 2 到真實數字之間的隨機數，Safari 桌機最多回報 8、iPhone 一律回報 2，Firefox 防指紋時固定回報 2。所以回報 12 以上就用 12，Chrome 這類回報真實數字的用不超過它的最大選項，數字不可信的用 8，iPhone、iPad 用 4，Firefox 用 1（見下方推論環境停住的說明）
- 切成好幾段的模型檔（`src/tools/transcribe/parts.ts`，有單元測試）：社群轉檔的大模型放在 assets.anoni.net，前面是 Cloudflare，免費方案的單一檔案快取上限是 512 MB。超過的檔案用 `node scripts/split-model.mjs <檔案> [每段的 MB]` 切成 `<檔名>.part0`、`.part1`…（預設每段 400 MB），把印出的內容填進 `models.json` 該模型的 `parts`（每段都要在 512 MB 以下，`tests/unit/transcribe.spec.ts` 會檢查）。Worker 依序下載每一段、比對 SHA-256，直接寫進預先配置好的一整塊記憶體，接回來的就是原本的檔案，再交給 Transformers.js。「已下載」看最後一段在不在快取裡
- 顯示卡（WebGPU）：畫面先問瀏覽器拿 adapter（`src/ui/gpu.ts`），拿得到、不是軟體模擬的（`isFallbackAdapter`，實測比 CPU 慢 15 到 29 倍）、緩衝區放得下 decoder 的詞嵌入表（`models.json` 的 `webgpu.buffer`），才出現「用顯示卡加速」的選項，預設勾選（`src/tools/transcribe/device.ts`，有單元測試）。WebGPU 用 4 位元的模型（`models.json` 的 `webgpu`）：8 位元版用到的 `MatMulInteger`、`DynamicQuantizeLinear` 在 onnxruntime 的 WebGPU 上沒有實作，大部分運算會退回 CPU。CPU 維持 8 位元版，瀏覽器裡實測 4 位元版在 CPU 上慢了約 1.7 倍（Node 上反而快約兩成）。large-v3-turbo 本來就是 4 位元版，兩邊共用
- 顯示卡失敗時（Worker 拿不到 adapter、建立推論環境或辨識失敗），畫面換一個新的 Worker 改用 CPU，從失敗的那一段重新送，並在畫面上說明。同一個 Worker 裡 Transformers.js 第二次載入仍然走 WebGPU，所以要換 Worker。辨識到一半才失敗時，上一段留著接下來的那句話、分辨說話者已經算好的聲紋會遺失。用顯示卡時送給 Worker 的是一份複本，失敗時才有原本的那段可以重送
- 每次建立 Worker 都在網址加上不同的查詢字串（`?worker&url` 匯入網址再自己建立）：WebKit 第二次用同一個網址建立 Worker 時，會被 Cross-Origin-Embedder-Policy 擋下，換核心數再轉一次就會失敗
- 模型下載完之後 3 分鐘還沒建好推論環境，畫面停下來說明可能是記憶體不夠（`STALL_MS`）。Firefox 用多個核心時，推論環境偶爾建不起來，也不會報錯：模型讀完了，Worker 的事件迴圈照常運作，就是等不到 Transformers.js 建好 session。8 個核心實測兩次停住一次，2 個核心也會，1 個核心從沒停過，跟模型有沒有切段無關。原因還沒找到，所以 Firefox 預設用 1 個核心，畫面上說明，讀者可以自己選更多
- 這台開發機與 CI 都沒有實體顯示卡，WebGPU 的速度要在讀者的電腦上量。網址參數 `?gpu=force` 不問瀏覽器、當成顯示卡可以用（測改用 CPU 的路徑，瀏覽器測試用它），`?gpu=any` 連軟體模擬的顯示卡也用（在沒有實體顯示卡的機器上確認 WebGPU 的辨識結果）
- 長錄音分段處理（`src/ui/audio-stream.ts`）：每次解碼約 10 分鐘，換成 16 kHz 單聲道交給 Worker，處理完才解碼下一段，記憶體用量跟錄音長短無關，轉好的段落邊轉邊顯示。WAV 直接讀 PCM。MP3 在音訊框的邊界切開，多帶前兩框一起解碼（音訊框會借用前一框的資料）。MP4、M4A、MOV 從 moov 的索引取出 AAC 樣本，交給 WebCodecs 的 `AudioDecoder`。檔案結構的解析在 `src/tools/transcribe/sources.ts`，有單元測試
- 這幾種格式超過 256 MB 也能處理（工具的 `acceptsLarge`），不限長度。其他格式，以及瀏覽器不支援 `AudioDecoder` 時的 AAC，整個檔案一次解碼，限制在 256 MB 與 2 小時。瀏覽器解不出聲音的檔案（例如沒有音軌的影片）畫面上說明
- 一段話碰到分段的結尾時先留著，接到下一段一起辨識，一句話不會被切成兩半。接縫上重複的那一句合併
- 分辨說話者（勾選才做，另外下載 28 MB）：每一段逐字稿用 3D-Speaker 的 CAM++ 算一個 192 維的聲紋（`src/ui/speaker-embed.ts`，特徵是 Transformers.js 的 `WeSpeakerFeatureExtractor` 換成 povey 視窗），全部辨識完再分群（`src/tools/transcribe/speakers.ts`，有單元測試）。平均連結的階層式分群，餘弦相似度低於 0.5 就不再合併，總共說不到 10 秒的群併到最相近的大群，依第一次開口的順序編號。分群樹用 nearest-neighbor chain 建，兩千段在一秒左右分完。不到 0.3 秒的段落算不出可靠的聲紋，沿用前一段的說話者
- 用 Whisper 的段落當單位，不另外執行分段模型：研究時比較過 pyannote 的分段、固定視窗與音量偵測，Whisper 的段落最準。換人點落在同一段裡時，那一段只能整段標給一個人，兩人同時說話時也只標一位。實測（base 模型，在畫面上用四位朗讀者剪接的錄音）兩人的錄音 71 段、三人的困難組（切在句子中間、沒有停頓就換人）130 段，人數都估對，以段落計標對 96.6% 與 93.7%
- CAM++ 的 ONNX 檔取自 sherpa-onnx 的 release，來源與 SHA-256 寫在 `src/tools/transcribe/speaker-model.json`，`node scripts/fetch-whisper.mjs` 一起下載到 `public/models/speaker/`。存進跟 Whisper 同一個不隨版本清掉的快取
- `src/ui/speaker-embed.ts` 跟 Transformers.js 共用同一份 onnxruntime（從同一個檔案路徑匯入，Vite 當成同一個模組），不另外下載 WebAssembly。這個檔案只能匯入 Transformers.js 與 onnxruntime，跟 Worker 共用的程式（模型清單、分群）由參數傳進來：打包時共用的程式會放進 Worker 的進入點，這裡再匯入它的話，WebKit 會把 Worker 的進入點當成另一份模組再執行一次，蓋掉 `onmessage`。瀏覽器測試會檢查建置產物裡沒有其他檔案匯入 Worker 的進入點
- 失敗時在主控台印出錯誤訊息（不含錄音的內容），讀者回報問題時用

## 使用統計

讀者打開哪些工具、有沒有處理完、在哪裡失敗，送到社群自架的 Umami（`aa.anoni.net`，網站 `anoni-net-gears`），程式在 `src/ui/analytics.ts`。不載入 Umami 的 script，由這裡直接送到 `/api/send`，CSP 只開這個網址，網站 id 與網址寫在 `src/ui/analytics-endpoint.ts`（`vite.config.ts` 也讀它）。 <!-- docs-style-lint: disable-line -->

| 事件 | 欄位 | 記在哪裡 |
|---|---|---|
| 頁面瀏覽 | 只有路徑，不含查詢字串與 `#`。第一次的 referrer 只留網域 | `src/app.tsx`，換工具或語系時 |
| `task` | `task`：桌面任務的 id | `src/app.tsx` 的 `onTask` |
| `file-add` | `kind`：image、document、pdf、media、archive、email、other | 暫存區的 `added`（`src/state.ts`），只算讀者加入的檔案 |
| `tool-done` | `tool`：工具 id | 暫存區產生新版本時，從空白開始的工具在結果第一次出現時（`useDoneOnce`），逐字稿在轉完時 |
| `tool-fail` | `tool`：工具 id 或 `tray`（加入時就讀不了），`reason`：unsupported、broken、too-large、encrypted、not-found、network、stalled、canvas-blocked（瀏覽器不讓讀取 canvas）、wasm-unavailable（瀏覽器關掉了 WebAssembly）、other | 暫存區的 `failed` 與各編輯畫面失敗的地方 |
| `save` | `how`：download、share、zip | 下載連結、`saveBlob`、系統分享、批次的壓縮檔 |
| `transcribe` | `model`、`device`（cpu、gpu）、`fallback`（顯示卡失敗退回 CPU 時是 1） | 逐字稿轉完時 |
| `qr-make` | `format`：產生器的格式（`QR_MODES`） | QR code 放進暫存區或下載時 |
| `qr-read` | `format`：讀到的格式（`QR_KINDS`） | QR code 讀取讀到時，暫存區的圖片自動讀出的不算 |

- 每個事件只能帶上表的欄位，值也要在 `EVENTS` 的清單裡，對不上整筆不送（`scrub`）。新增事件或欄位時改 `EVENTS`，`tests/unit/analytics.spec.ts` 會檢查工具、任務與模型的清單跟程式一致
- 不送檔名、檔案大小、檔案內容、讀者輸入的文字、網址檢查的網址、信件的寄件人與網域、雜湊值、查證的結果。螢幕尺寸取到百位數
- 只在 `anoni.net` 上送，本機預覽與測試都不送。瀏覽器開了 Do Not Track 或 Global Privacy Control 不送，頁尾只說明不記錄，不提 Umami 也不顯示開關。頁尾用一句話說明只記錄使用次數、存放在社群自架的 Umami（不寫主機名），讀者可以選「不要記錄」，選擇存在這個瀏覽器的 localStorage（`gears-analytics-off`）
- `tests/e2e/analytics.spec.ts` 在 Chromium 把 `anoni.net` 指到預覽伺服器（`vite.config.ts` 的 `preview.allowedHosts`），攔下送到 Umami 的請求，確認內容與頁尾的開關。其他測試都在 localhost，`tests/e2e/guard.ts` 擋下任何對外連線
- 看數字用工作區的 `python3 umami/report.py --website gears events --funnel task file-add tool-done save`

## 建議與回饋

讀者在「建議與回饋」許願新功能、回報問題，或寫下哪裡不好用（`/gears/feedback/`，畫面在 `src/ui/FeedbackPage.tsx`，送出在 `src/feedback.ts`）。原本叫「許願區」，回報問題放在許願底下不自然，2026-10-18 改名，許願新功能改寫在說明裡。入口有兩個：桌面最下面一行的「使用者區」，以及頁尾的「建議與回饋」。使用者區放跟 Gears 本身有關、不是工具的頁面（`src/ui/tool-meta.ts` 的 `USER_PAGES`），目前是範例與建議與回饋，之後的設定也放這裡。2026-10-19 起桌面改成清單，使用者區從一組卡片縮成一行連結，畫面上不寫「使用者區」這個標題，只留給讀螢幕軟體（`aria-label`）。

- 表單由 Gears 自己畫，送到社群自架的 Formbricks（`form.anoni.net`），用它給網頁用的公開 API（`/api/v1/client/<環境>/responses`），不需要金鑰。不嵌入 Formbricks 的頁面：整個網站送了 `Cross-Origin-Embedder-Policy: require-corp`，別的網站的頁面嵌不進來，讀者也不必認識另一個服務。畫面上不提 Formbricks
- CSP 的 `connect-src` 只開送出的那一個路徑（`FEEDBACK_ENDPOINT_CLEARNET`，meta 標籤與標頭都有）。onion 版送到 `form.<onion>` 的同一個路徑（`FEEDBACK_ENDPOINT_ONION`），兩個網址分成兩個常數，建置時沒用到的會被拿掉，onion 版的產物裡沒有 clearnet 的網址
- 送出前畫面寫明送到哪裡、一併送出哪些資訊、暫存區的檔案不會送出、伺服器記下什麼（`feedback.privacy`）。請求不帶 cookie 與 Referer
- 一併送出的是讀者從哪個工具過來（`tool`，桌面是 `home`，在 `src/app.tsx` 記下）、介面的語系（`locale`）與版本（`version`），對應問卷的三個 hidden fields
- Formbricks 每個語系一份問卷，id 寫在 `FEEDBACK_SURVEYS`。題目 id 與選項照社群工作區的 `formbricks/gears_survey.py`，選擇題存的是選項的文字，`feedback.kind.*` 與 `feedback.frequency.*` 的字串要跟那份檔案一字不差，改字時兩邊一起改
- 問卷是草稿或已關閉時伺服器回 403，畫面說明建議與回饋暫時沒有開放。送不出去時填好的內容留著，讀者可以再按一次
- 收到的需求在社群的工作區整理（`formbricks/`），決定要做的改寫成這個 repo 的 issue，掛 `request` 標籤，不公開讀者寫的原文與聯絡方式。送出之後的畫面連到 `request` 標籤的 issue 列表
- 瀏覽器測試（`tests/e2e/feedback.spec.ts`）攔下送出的請求，確認內容、成功與 403 的畫面，以及暫存區的檔案留著

## 範例

手邊沒有檔案時試用，對外展示時也用得到（`/gears/samples/`，畫面在 `src/ui/SamplesPage.tsx`）。入口在桌面的使用者區，有範例的工具在工具畫面放一行「沒有檔案？用範例試試」（`SampleLink`，`SAMPLE_TOOLS`），打開範例頁時那個工具的範例排在最前面，不捲動頁面。

| 工具 | 範例 | 工具找得到的東西 |
|---|---|---|
| 清除中繼資料 | 帶拍攝位置的手機照片 | 台北 101 附近的 GPS、手機型號、拍攝時間與時區 |
| 文件開啟前檢查 | 打開時會連線的 Word | 遠端範本、外部圖片、INCLUDEPICTURE 的追蹤圖片 |
| 信件檢查 | 冒充銀行的釣魚信 | SPF 與 DMARC 沒有通過、顯示名稱裡的另一個信箱、回覆地址換成別的網域、連結文字跟網址不同、HTML 附件 |
| 查證 | 改過金額的報價單 | 增量更新留下的舊版本，可以比對兩版的差異 |
| QR code 與條碼讀取 | 22 張 QR code 與條碼 | 見上方「QR code 的內容格式」 |

- 內容都是假的：人名與帳號是虛構的，網域用 `example.*`，IP 用保留給文件的位址，照片的位置用公開的地標。頁面開頭寫明
- 檔案按下按鈕時才在瀏覽器裡產生，不放進 repo（`src/ui/samples.ts`，位元組由 `src/tools/samples/files.ts` 寫出，pdf-lib 用到時才載入）。照片用 canvas 畫一張圖再插進 EXIF（`src/tools/samples/exif.ts`，測試的 `tests/helpers/fixtures.ts` 也用它），Tor Browser 沒有允許讀取 canvas 時畫出來的是雜訊，照樣帶著 EXIF
- 範例檔放進暫存區時標成 `sample`（`TrayFile.sample`），檔案畫面標出「範例檔案」。暫存區有範例時，`file-add`、`tool-done`、`tool-fail`、`save` 都不記（`src/ui/analytics.ts` 的 `setSampleGate`），同時有讀者自己的檔案時也一起不記，判斷不了是哪一個檔案的。這是維護者要知道的事，畫面上不寫。範例頁的頁面瀏覽照樣記
- 打開的方式依工具不同（`src/app.tsx` 的 `openSample`）：處理檔案的工具先換到它的網址再加入檔案，編輯畫面直接打開。查證讀整個暫存區，加入之後換到查證。信件檢查用預設值 `tray:<檔案 id>`
- 瀏覽器測試（`tests/e2e/samples.spec.ts`）逐一打開每份範例，確認工具找到上表的東西
- 新增範例：在 `FILE_SAMPLES` 加一筆、`files.ts` 寫產生的程式，三個語系加上 `samples.<id>.title` 與 `samples.<id>.desc`，`samples.spec.ts` 加一個測試

## 離線使用

第一次開啟之後，沒有網路也能使用。service worker 的範本在 `src/sw/sw-template.js`，建置時 `vite.config.ts` 的 `serviceWorker()` 列出 `dist/` 的檔案、算出版本（所有檔案內容的雜湊），輸出成 `/gears/sw.js`。

- 安裝時先存頁面、程式、圖示與 165 清單，約 7 MB，其中 PDF 遮蔽的 pdf.js 約 1.7 MB（壓縮後約 500 KB），條碼的 zxing-wasm 約 950 KB（壓縮後約 420 KB，暫存區的圖片都會用到，所以預先存）。人臉與文字辨識的模型與 WebAssembly、pdf.js 的 CMap 與字型（`vendor/`、`models/`、`assets/ort-wasm-*`）用到時才存
- 逐字稿的 Whisper 模型存在另一個不隨版本清掉的快取（`gears-models`），換新版本時不必重新下載 80 到 250 MB。網址帶著模型的版本，清單以外的在新版本接手時刪掉。畫面上標出已下載的模型，可以刪除
- 只存工作台自己的檔案。讀者放進暫存區的檔案只在記憶體裡，不寫進快取，只有換版本的那一刻經過 service worker（見下一項）
- 換版本要重新載入頁面，暫存區只在記憶體裡，重新載入就沒了（`src/ui/offline.ts`）。暫存區是空的、畫面上也沒有填到一半的東西時（桌面、授權頁、還沒選檔案的工具說明，從空白開始的工具不算），不出現提示，等分頁切到背景（`visibilitychange`）就直接換，讀者回來時已經是新版本。暫存區有檔案時，畫面上方提示，讀者按「重新載入」才換上，避免同一個分頁混用新舊程式
- 帶著暫存區換版本：新版本接手之後，頁面把暫存區（`tray.snapshot()`，檔案的每個版本、檢查結果與選取的檔案）用 `postMessage` 交給它，service worker 只放在自己的記憶體裡，用 `waitUntil` 撐到重新載入的頁面拿走（`tray.restore()`），最多 60 秒就放掉，不寫進快取或任何儲存空間。Blob 是參照，大檔案不會多複製一份。交給的對象是重新載入之後會接手的那一個：等新版本接手完成（`activated`）再交給它，不用固定的等待時間，電腦忙的時候新版本比較晚接手，交給舊版本的話它在重新載入的途中就被換掉了。新版本被更新的一版取代，或 8 秒內沒有接手，就交給目前的版本，重新載入不會讓等著的版本接手。5 秒內沒有回應就不重新載入，提示讀者先下載需要的檔案，再按一次才清空暫存區重新載入。2026-10-17 在 Chromium、WebKit、Firefox 實測過（含 50 MB 的檔案），測試也在這三種核心與 iPhone 尺寸執行。這個流程由舊頁面的程式交出、新版本的 service worker 收下，之後的版本都要保留 `sw-template.js` 的 `hold` 與 `take`
- 讀者自己重新整理（手機上常是不小心往下拉）時暫存區不會帶過去，所以暫存區有檔案時先擋：`html.has-files` 加上 `overscroll-behavior-y: none`，Android 的 Chrome、Firefox 與 iOS 16 以後的 Safari 不會觸發下拉重新整理。iOS 的 Safari 光靠 CSS 擋不住，頁面在最上面、手指往下拉時另外攔下 touchmove（兩指、往上捲、在能捲動的區塊裡捲動不攔）。重新整理或關閉分頁之前也請瀏覽器先確認（`beforeunload`，iOS 的 Safari 不支援）。讀者按重新載入換新版本時不確認（`src/app.tsx` 的 `useKeepTray`、`offline.ts` 的 `isReloading`）
- 按下「重新載入」之後按鈕改成「更新中…」，新版本沒有接手時最多等 8 秒也照樣進行，按鈕不會停在那裡。重新載入之後顯示「已換上新版本」，暫存區帶過來了、或沒能帶過來也一起說明，這些記號放在 `history.state`，不寫進 localStorage
- 轉逐字稿、自動尋找人臉、組 PDF、算雜湊值這類重新載入就會中斷的工作，進行中不出現換版本的提示，做完才出現（`src/ui/working.ts` 的 `useWorking`，新增長時間的工作時記得接上）。提示也寫明還沒套用或下載的結果會消失，例如還沒放進暫存區的逐字稿、還沒套用的遮蔽框
- 換版本的測試自己起一個靜態伺服器提供 `dist/`，瀏覽器檢查更新的請求 `page.route` 攔不到
- 比對快取時忽略 `Vary`：模組腳本的請求帶著 `Origin`，伺服器回應的 `Vary: Origin` 會讓預先存的那份對不上
- 部署時 `sw.js` 要設定不快取（`Cache-Control: no-cache`），瀏覽器才查得到新版本
- 瀏覽器測試預設擋掉 service worker（`playwright.config.ts`），它接手的請求 `page.route` 攔不到。離線的測試（`tests/e2e/offline.spec.ts`）自己打開，只在 Chromium 執行

## 部署

網址是 `https://anoni.net/gears/`，做法跟新聞導讀一樣：GitHub Actions 建置、推到 `build` 分支，m6 每 5 分鐘拉一次。

- `.github/workflows/deploy.yml`：main 的 CI 通過之後執行（`workflow_run`），每週一另外重建一次更新 165 清單，也可以手動觸發。產物沒變時不推
- `build` 分支的 `site/` 是網站，`deploy/models.txt` 是逐字稿的模型清單（`node scripts/fetch-whisper.mjs --manifest`），`deploy/nginx-headers.conf` 是 nginx 送的標頭（`vite.config.ts` 的 `nginxHeaders`，跟預覽伺服器送的同一組 CSP 與 cross-origin isolation）
- Whisper small、base 與 CAM++ 不進 `build` 分支（單一檔案超過 GitHub 的 100 MB）。m6 照清單下載到 `/srv/anoni-net-gears/models/`，比對 SHA-256，nginx 的 `/gears/models/whisper/`、`/gears/models/speaker/` 讀那裡。路徑帶著模型的版本，換版本時舊的目錄不會自動刪除
- `assets/` 的檔名帶雜湊，上一版的檔案多留一輪：已經開著舊頁面的讀者，之後才載入的工具還會要舊的檔案
- 複製到 `build` 分支時 rsync 用 `--checksum` 比對內容，推送前用 `node scripts/check-site.mjs` 確認頁面、`sw.js` 與程式參照到的檔案都在。2026-10-17 曾因 rsync 只比大小與時間，頁面只換了雜湊、大小不變，建置與 checkout 又在同一秒，新的頁面沒有複製過去，`sw.js` 清單裡的檔案也已經刪掉，service worker 裝不起來
- m6：`/srv/anoni-net-gears/build` 是 `build` 分支的 clone，ubuntu 的 crontab `*/5 * * * * /home/ubuntu/gears-pull.sh`（原始檔 `tools/m6-pull.sh`，改了要再複製一次），log 在 `/home/ubuntu/gears-pull.log`。新版本上線前先把模型下載齊、把標頭換上（`/etc/nginx/snippets/gears-headers.conf`，`nginx -t` 通過才 reload），service worker 預先存的檔案連當時的標頭一起存，順序反過來的話，讀者的 Worker 會一直帶著舊的 CSP
- nginx 的 location 與快取標頭的範本在 `tools/nginx-gears.conf`，實際設定在 m6 的 `/etc/nginx/conf.d/anoninet.conf`，改了要手動同步。頁面與圖片帶 `no-transform`，Cloudflare 不在頁面注入 Web Analytics 與 JS Detections 的 script，也不用 Polish 重新壓縮圖片。其他檔案不能帶：帶了 `no-transform` 的回應 Cloudflare 完全不壓縮，連 nginx 送出的 gzip 也會解開，讀者取得的是原始大小（`.wasm` 用 `application/wasm` 送出，onnxruntime 的 WebAssembly 壓縮後約小四分之三）。pdf.js 的 `.mjs` 另外指定 JavaScript 的 MIME
- Cloudflare：Cache Rule「gears respect origin」讓 `/gears/` 的邊緣與瀏覽器都照 nginx 的快取標頭，頁面、manifest 與 165 清單是 `no-cache`，每次回來確認，`sw.js` 另由「docs sw.js no-cache」整個不快取。Transform Rule `onion-anoni.net` 排除 `/gears`，`onion-gears` 對 `/gears/` 送 `Onion-Location`，指到 onion 版的同一頁（見下方「onion 版與 Tor Browser」）
- 自己建置時（例如本機預覽）先執行 `node scripts/fetch-165.mjs` 與 `node scripts/fetch-whisper.mjs`

## onion 版與 Tor Browser

網址是 `http://gears.<onion>/`，跟社群其他 onion 服務一樣切成子網域，網站放在根目錄。`GEARS_TARGET=onion npm run build` 建置到 `dist-onion/`，建置目標寫在 `vite.config.ts` 與 `src/site.ts`：

- 頁面只連自己的網域，以及建議與回饋的送出網址（onion 的表單伺服器，見上方「建議與回饋」）。使用統計在建置時整段拿掉，頁尾寫明不記錄。社群轉檔的模型改由 onion 網站的 `/models/assets/` 提供，m6 的 nginx 指到 `assets.anoni.net` 的同一份檔案。分享卡片的圖片放在 clearnet，不放。逐字稿的 large-v3-turbo 仍然在讀者選擇之後從 Hugging Face 下載，經過 Tor 網路
- 頁尾連到 onion 的社群首頁
- `node scripts/check-site.mjs dist-onion / --onion` 檢查頁面、程式、樣式與 manifest 沒有連到 clearnet 的 anoni.net（授權說明的文字檔會寫到出處，不算）。`npm run test:onion` 建置之後在根目錄執行冒煙測試（`tests/onion/`），CI 在 Chromium 那台執行
- 部署：`deploy.yml` 建置兩份，onion 版推到 `build` 分支的 `onion/`，標頭是 `deploy/nginx-headers-onion.conf`，m6 的拉取腳本換到 `/etc/nginx/snippets/gears-onion-headers.conf`。nginx 的 server block 與快取的對照（`$gears_onion_cache_control`）在 `tools/nginx-gears.conf`

Tor Browser 15.0（Firefox 140 ESR）一般安全等級的實測結果：

- canvas：讀者允許之前，`getImageData` 與 `toBlob` 一律得到亂數，不會報錯。讀者點擊之後的第一次讀取，會在網址列的 canvas 圖示跳出詢問（Allow、Block），允許之後同一個分頁就正常。`src/ui/canvas-access.ts` 讀取之前先畫四個點讀回來比對，讀不到時丟出 `CanvasBlockedError`。QR code 讀取、HEIC 轉 JPEG 與預覽、遮蔽的套用與自動尋找、PDF 轉成圖片、查證的畫面比對、列印追蹤點的判斷與套用、縮成常見尺寸都接上，畫面上請讀者允許之後再按一次。不檢查的話 HEIC 與 PDF 會輸出一張雜訊圖。瀏覽器測試（`tests/e2e/canvas-blocked.spec.ts`）把 `getImageData` 換成亂數來模擬
- 沒有 service worker，不能離線使用，畫面上也不會出現可以離線使用的提示
- 沒有 cross-origin isolation，逐字稿只能用 1 個核心（實測 15 秒的華語錄音，base 模型 7.5 秒轉完）。沒有 WebGPU 與 `AudioDecoder`，MP4、M4A 整檔解碼（上限 256 MB）
- 不能用相機，QR code 讀取改選照片
- 「較安全」等級關掉 JIT，WebAssembly 照樣可以用，只是比較慢。「最安全」等級關掉 JavaScript，只看得到 `noscript` 的說明

在本機用無頭的 Tor Browser 測試：用 `TOR_PROVIDER=none` 啟動、不連 Tor，profile 的 `user.js` 讓本機網址不走代理（`network.proxy.allow_hijacking_localhost` 與 `no_proxies_on`），加上 `--marionette -remote-allow-system-access` 就能用 Marionette 操作頁面與瀏覽器本身。Tor Browser 一直是私密瀏覽、又有 first-party 隔離，允許 canvas 的權限要用分頁的 `contentPrincipal` 加（`Services.perms.addFromPrincipal(p, "canvas", ALLOW_ACTION)`），不能預先寫進 profile。Marionette 與 WebDriver BiDi 不能同時開 session，安全等級改過之後會留在 profile（NoScript 自己也存了一份），換回來要重建 profile。

## 版本號

版本號是 commit 的時間（台灣時間），寫成「年.月.日 時:分」，例如 `2026.10.17 21:44`，旁邊附上 commit（`src/core/version.ts`，有單元測試）。不必手動調整，同一個 commit 每次建置都得到同一個版本號，每週一重建 165 清單時也不會變。原本只寫到日期，開發頻繁的日子裡，換版本的提示一直顯示同一個日期，讀者分不出差別，2026-10-17 起寫到分鐘。

- `vite.config.ts` 在建置時用 `git log -1 --format=%ct` 算好，透過 `define` 寫進 `__GEARS_VERSION__`，頁面上從 `src/version.ts` 讀。本機預覽有還沒 commit 的修改時（`git status --porcelain` 不是空的），改用建置當下的時間，沒有 git 時也是。建置產物都在 `.gitignore` 裡，CI 上的工作目錄是乾淨的，版本號照樣是 commit 的時間
- 顯示在頁尾的最後一行，commit 連到 GitHub 上的那一次修改，讀者回報問題時照這裡抄
- 換上新版本之後的提示（「已換上新版本（2026.10.17 21:44）」）與查證紀錄也記下版本號

## 165 反詐騙清單

網址檢查比對 165 反詐騙諮詢專線公開的「遭停止解析涉詐網站」清單（政府資料開放平台資料集 176455，內政部警政署，政府資料開放授權條款第 1 版），每月更新。

```bash
node scripts/fetch-165.mjs   # 下載並整理成 public/data/165.txt
```

檔案約 1.5 MB，不進版控，部署時先執行一次再建置。沒有這個檔案時建置照樣成功，網址檢查顯示清單無法載入，其他檢查不受影響。瀏覽器測試攔截這個請求，改給固定的測試清單，結果不隨每月的資料變動。

## 網址

每個工具有自己的網址，例如 `/gears/qrcode/`，簡體中文與英文在前面加上 `zh-cn/`、`en/`（`/gears/en/qrcode/`）。建置時 `vite.config.ts` 替每個語系、每個工具產生一份 HTML，`lang`、標題、描述與 `noscript` 取自該語系的字串，並列出其他語系的 `hreflang`。內容跟首頁相同，打開之後由 `src/router.ts` 判斷語系與要顯示哪個工具。主機不需要轉址設定。

認不得的網址（`src/pages.ts` 的 `NOT_FOUND`）顯示「找不到這一頁」與回到桌面的按鈕（`src/ui/NotFoundPage.tsx`），不當成桌面，讀者才知道網址打錯了。建置時另外產生 `404.html`（不寫 canonical 與分享卡片，帶 `noindex`），nginx 找不到檔案時送出它，狀態碼仍是 404（`tools/nginx-gears.conf` 的 `error_page`）。原本落到 nginx 預設的英文 404 頁。

## 搜尋引擎與分享預覽

每一頁由 `vite.config.ts` 的 `localized` 產生（見上方「網址」），`seoTags` 加上：

- `canonical` 與三個語系的 `hreflang`，`x-default` 指向正體中文
- Open Graph 與 Twitter 的卡片：標題與描述跟 `meta.<id>.title`、`meta.<id>.description` 相同，圖片每個語系一張
- 首頁另外有 WebApplication 的結構化資料（`application/ld+json`，瀏覽器不執行，CSP 不必放寬）

建置時也產生 `sitemap.xml`，列出每個語系的每一頁與彼此的 `hreflang`。社群首頁的 `robots.txt`（`anoni-net/www` 的 `templates/robots.txt.j2`）指到這裡。

分享卡片（`og:image`）由 `node scripts/make-og.mjs <輸出目錄>` 產生，不進 repo，上傳到 m6 的 `/srv/images-anoni-net/gears/og/`，網址填進 `src/og-images.json`。檔名帶內容雜湊，改了卡片上的文字或樣式就重新產生一次。

首頁描述（`meta.home.description`）要涵蓋三組工具，新增或改名工具時一起看一次。網頁標題用名詞片語寫出這一頁能做什麼，不必跟桌面上的工具名稱一字不差。

## 其他欄位的內容

檢查時找到的「其他程式自訂的欄位或識別碼」也列出名稱與內容（`src/tools/strip-metadata/preview.ts`），廠商的私有區段常藏著序號、帳號或裝置的識別碼。文字直接顯示，二進位資料抽出連續 4 個字元以上的可讀字串，抽不到就顯示開頭的 16 個位元組。同一種資訊的不同值逐行列出（`mergeFindings`），超過 8 個只列前 8 個。

## 介面上的限制

- 能不用 canvas 輸出圖檔就不用。Brave 預設會擾動 canvas 讀出來的像素，QR code 的 PNG 由 `src/core/png-encode.ts` 直接寫位元組。遮蔽與 QR code 讀取必須解碼影像，只能用 canvas：遮蔽輸出後抽查每個框是否夠黑，門檻容許這點雜訊。QR code 讀取對雜訊不敏感
- 用到 WebAssembly 的功能（逐字稿、遮蔽的自動尋找、HEIC 的解碼器、QR code 以外的條碼）先用 `src/ui/wasm.ts` 的 `wasmAvailable()` 檢查。iPhone、iPad 與 Mac 的鎖定模式會關掉 Safari 的 WebAssembly，不檢查的話讀者要等模型下載完才失敗，收到的還是「記憶體不夠」這類錯誤的原因。檢查時實際編譯一個 8 個位元組的空模組，只看 `typeof WebAssembly` 不夠。逐字稿一打開就說明、開始的按鈕不能按，自動尋找請讀者手動框選，HEIC 說明載入不了解碼器。瀏覽器測試（`tests/e2e/wasm-unavailable.spec.ts`）把頁面的 `WebAssembly` 拿掉來模擬
- 工具以外的頁面（`src/pages.ts` 的 `pageIds`：授權與來源、語言模型速度量測、建議與回饋、範例）不顯示暫存區，版面改成單欄（`.workbench.solo`）。暫存區的檔案仍在記憶體裡，回到桌面就看得到
- 站內導覽不用一般的 `<a href>`。一般的連結會重新載入頁面，暫存區只在記憶體裡，會整個清空。改用 `src/router.ts` 的 `navigate()`，外觀要像連結時用 `button.link`。`navigate()` 換頁之後捲回頂端，不然瀏覽器會沿用原本的捲動位置，手機上從桌面下方點進比較長的頁面時，畫面停在新頁面的最底部（2026-10-18 建議與回饋遇到）
- 檔案畫面處理完之後，下載放在工具列表之前，接著是處理報告與退回上一步。原本下載在最後面，手機上要捲過好幾組工具才看得到，最顯眼的按鈕反而是建議的下一個工具。手機上平常先看檢查結果、預覽排在後面，處理完之後預覽排回前面（`.columns.processed`），遮蔽完馬上看得到框有沒有蓋對。編輯畫面套用之後捲回檔案的開頭（2026-10-19 的使用回饋）
- 沒有找到中繼資料不用綠色：暫存區的狀態寫「沒有中繼資料」、用灰色，檔案畫面另外說明只檢查了中繼資料，截圖裡的電話要用遮蔽、文件打開時會不會連線要用開啟前檢查（`findings.scope`）。綠色讀起來像「這個檔案安全」，只留給加密完成
- 解碼圖片一律用 `src/ui/image-decode.ts` 的 `decodeImage()`，不要直接呼叫 `createImageBitmap()`，HEIC 才會在不支援的瀏覽器上改用 libheif
- 遮蔽畫面分成兩區：會改變框的動作（自動尋找、復原、清除）在圖片上方，套用與取消在圖片下方的完成列，完成列捲動時固定在畫面底部（`position: sticky`）。窄螢幕的復原、清除只顯示圖示，文字留在按鈕裡給讀螢幕軟體
- 不用 `<select>`。Linux 版 WebKit 建立下拉選單時，內部的樣式表會被 CSP 擋下，主控台留下錯誤。選項不多時改用攤開的選項按鈕，手機上也少點一下

## 無障礙

以 WCAG 2.1 AA 為目標。`tests/e2e/a11y.spec.ts` 用 axe-core 檢查每個工具頁、加入檔案與清除之後的畫面，以及深色模式，有違規就失敗。新增工具或改版面之後，記得把新的頁面或狀態加進去。

- 顏色：主要按鈕的白字要有 4.5:1 的對比，深色模式也用 `cyan-800`，`cyan-700` 只有 3.93:1
- 遮蔽的畫布可以用鍵盤操作：方向鍵移動游標、Enter 標出兩個角、Delete 刪掉最後一個框、Escape 取消。畫布是 `role="application"`，操作說明用 `aria-describedby` 接上
- 處理中、找到幾個框這類會變動的訊息用 `role="status"` 或 `aria-live`，讀螢幕軟體才唸得到
- 自動檢查抓不到的部分（讀螢幕軟體實際唸出來的內容、操作順序）要人工確認

## 測試用的檔案

照片與圖檔不進 repo，品牌圖示（`public/icons/`）例外。單元測試用 `tests/helpers/fixtures.ts` 組出結構完整的檔案。瀏覽器測試先用 canvas 產生一張可以解碼的圖，再塞進中繼資料。影片的測試檔見上方「影片的關鍵影格」。

HEIC 有兩種測試檔。單元測試在測試裡組出結構完整、不能解碼的檔案。能解碼的真 HEIC 由 `tests/global-setup.ts` 在瀏覽器測試開始前呼叫 `scripts/make-test-images.py`，用 pillow-heif 產生到 `tests/.generated/`（不進版控）。有 `uv` 就用 `uv run --with pillow-heif==1.8.1`，CI 用 `astral-sh/setup-uv` 安裝。產生不了時，用到真 HEIC 的測試會略過。

QR code 的測試把產生的 PNG 解碼回像素，用 `jsQR` 讀出文字，跟輸入比對，中文與 Wi-Fi、vCard、活動的特殊字元都要測。編碼寫錯的典型後果是掃得出來、內容卻錯。

QR code 讀取（`src/ui/qr-scan.ts`）要能讀翻拍螢幕的照片。白底上拍到的子像素直紋會讓 jsQR 讀不出來，所以讀不到時逐級減半再讀，縮小由程式自己平均像素：WebKit 用 canvas 縮圖時只取樣部分像素，紋路一直留著，iPhone 上讀不出來的就是這種照片。瀏覽器測試用 canvas 畫一張帶直紋的 QR code 重現。

## 清除中繼資料支援的格式

格式的範圍參考 mat2（Tails 的 Metadata Cleaner 背後的工具），每種格式一個檔案，在 `src/tools/strip-metadata/index.ts` 登記。原則跟 JPEG 一樣：用白名單保留影像需要的部分，其他一律拿掉，不重新編碼。

| 格式 | 做法 |
|---|---|
| JPEG | 拿掉 APP 區段與註解，接在影像後面的資料一併拿掉，只把旋轉方向寫回去 |
| PNG | 保留影像需要的 chunk，文字、時間與 eXIf 拿掉 |
| HEIC、AVIF | 原地把 EXIF 與 XMP 換成空白的內容，長度與結構不變 |
| WebP | 拿掉 EXIF 與 XMP chunk，清掉 VP8X 的旗標，重算 RIFF 長度 |
| GIF | 拿掉註解與不認得的應用程式延伸，保留迴圈與色彩描述檔 |
| TIFF | 用白名單保留解碼需要的標籤，原地改寫 IFD，拿掉的標籤與 EXIF、GPS 子 IFD 的資料清成零 |
| SVG | 拿掉 metadata、註解與 inkscape、sodipodi 的元素與屬性（常帶著電腦上的路徑） |
| BMP | 沒有描述用的欄位，只拿掉檔尾的附加資料 |
| PNM | 拿掉 # 開頭的註解 |
| JPEG XL | 拿掉 Exif、xml、jumb、brob box |
| Word、Excel、PowerPoint（docx、xlsx、pptx） | 見下方「文件」 |
| LibreOffice（odt、ods、odp、odg） | 見下方「文件」 |
| PDF | 見下方「文件」 |
| MP3、M4A、MP4、MOV、WAV、AVI、FLAC、Ogg、Opus、MKV、WebM | 見下方「音訊與影片」 |
| ZIP、TAR、gzip、EPUB、種子檔、HTML | 見下方「壓縮檔與其他格式」 |

驗證時在本機用 Pillow 產生帶中繼資料的真實檔案，清除之後再用 Pillow 解碼，確認像素與原檔相同。

## 文件

Office 與 LibreOffice 的文件都是 zip 包著一組 XML，`src/core/zip.ts` 用瀏覽器內建的 `DecompressionStream` 解壓縮，`src/core/xml.ts` 逐一讀出標籤，只改動規則指定的元素、屬性與文字，其餘照抄。重新打包時時間戳記統一成 1980-01-01，不寫附加欄位與註解，檔案的順序與壓縮方式維持原樣。

| 格式 | 拿掉或改寫 |
|---|---|
| docx、xlsx、pptx（`ooxml.ts`） | 文件摘要（作者、公司、時間、編輯時數）、自訂屬性與 `customXml`、預覽圖、印表機設定、敏感度標籤、數位簽章、Word 的 rsid 與文件識別碼、範本與合併列印來源、Excel 記下的存檔路徑、外部連結的路徑只留檔名，指向拿掉部件的關聯、`[Content_Types].xml` 與 `r:id` 一併修正 |
| odt、ods、odp、odg（`odf.ts`） | `meta.xml` 清空、`settings.xml` 的印表機與資料庫設定、預覽圖、數位簽章、rsid，manifest 跟著更新，第一個檔案仍是不壓縮的 `mimetype` |
| PDF（`pdf.ts`） | 文件資訊、XMP、文件識別碼、PieceInfo、數位簽章，重新寫出時只保留從文件目錄走得到的物件，增量更新留下的舊版本不會帶過去 |

三種格式都一樣的部分：

- 註解與追蹤修訂是讀者寫進去的內容，預設保留下來，作者改成 `Author`，時間拿掉或改成固定的值。檢查時列在「文件內容裡要留意的」，提醒讀者刪除的文字仍在檔案裡（`CONTENT_FINDINGS`，清除中繼資料的 `resolves` 不包含它們）
- 讀者可以在同一區勾選「刪除所有註解」、「接受所有追蹤修訂」，選擇透過 `RunOptions` 傳給清除工具，內嵌的文件照同樣的選擇處理。Word 接受修訂時，刪除的內容與格式修訂前的舊值整個拿掉，插入的內容拿掉標籤留下文字，刪除的表格列整列拿掉。Excel、PowerPoint 的註解連同 VML 方塊、討論串與作者清單一起拿掉。ODF 拿掉 `office:annotation` 與 `tracked-changes`。PDF 拿掉標記類的註解與彈出視窗，表單欄位不動
- 內嵌的圖片交給對應格式的處理程式，內嵌的 Office 文件也是，最多三層
- 加密的文件、有巨集的 Office 文件（docm 等）不處理

pdf-lib（MIT，相依的 pako、tslib 等也一起打包）壓縮後約 180 KB，打開 PDF 時才載入，授權全文在 `licenses/pdf-lib.txt`。透過 `src/tools/strip-metadata/pdf-lib.ts` 載入，建置出來的檔名才看得出用途。

單元測試用 `tests/helpers/documents.ts` 組出在各處都塞了秘密字串的文件，清除後逐一確認不在檔案裡、內文還在、套件內部的關聯前後一致。真實的檔案在本機用 python-docx、openpyxl、python-pptx 產生，再用 LibreOffice 轉成 ODF 與 PDF，清除之後用 LibreOffice 開啟並轉成 PDF，比對文字與原檔相同。

## 音訊與影片

手機錄的影片在 MP4、MOV 裡記錄拍攝位置、手機型號與系統版本，音樂與錄音的標籤記錄演出者、封面與編碼軟體。

| 格式 | 做法 |
|---|---|
| MP4、MOV、M4A（`mp4.ts`） | `udta`、`meta`、XMP 與廠商的 `uuid` 改成 `free`、內容清成零，`mvhd`、`tkhd`、`mdhd` 的時間清成零，計時的中繼資料軌（iPhone 的 `mebx`、GoPro 的 `gpmd`、Google 的 `camm`）每一格的資料清成零 |
| MP3（`mp3.ts`） | 拿掉開頭的 ID3v2，檔尾的 ID3v1、APEv2 與 Lyrics3，只留音訊框 |
| WAV、AVI（`riff.ts`） | 用白名單保留需要的 chunk，其他的代號改成 `JUNK`、內容清成零，`JUNK` 原本的內容也清掉，RIFF 之後附加的資料拿掉 |
| FLAC（`flac.ts`） | 保留 STREAMINFO、SEEKTABLE、CUESHEET，標籤、封面、程式自訂的區塊拿掉 |
| Ogg Vorbis、Opus（`ogg.ts`） | 註解封包換成空白的，標頭重新分頁，後面每一頁重編序號、重算 CRC |
| MKV、WebM（`ebml.ts`） | `Tags`、標題、建立時間、軌道名稱換成同樣長度的 `Void`，`MuxingApp`、`WritingApp` 清成空字串，母元素的 CRC-32 重算 |

MP4、MOV、AVI、MKV 的影音資料位置記在索引裡，所以原地處理，檔案長度不變，影音資料一個位元都不動。各格式的標籤名稱不同，`media-tags.ts` 把它們對應到同一組資訊。附加檔案（MKV 的字型與封面）是內容，保留下來，檢查時另外提醒。

手機影片常有好幾 GB，超過瀏覽器一次能讀進記憶體的大小。超過 256 MB 的檔案（`LARGE_FILE`）不整個讀進來，暫存區只讀開頭判斷格式，交給有 `acceptsLarge` 的工具。目前只有 MP4、MOV、M4A 支援：中繼資料都在 mdat 以外的 box，`stripMp4Blob` 只讀那幾個 box 與計時中繼資料的那幾格，改好的部分跟原檔的其他片段組成新的 Blob，影音資料不經過記憶體。其他格式的大檔案，以及遮蔽、加密這類需要整個檔案的工具，畫面上說明目前沒有辦法處理。

檔案畫面用瀏覽器內建的播放器預覽，CSP 加上 `media-src blob:`，只能播放暫存區裡的檔案。播放器自己建立與收回網址，換版本時先讓播放器放掉網址，iOS 的 Safari 才不會去讀已經收回的網址。

單元測試用 `tests/helpers/media.ts` 組出各格式的測試檔。真實的檔案在本機用 ffmpeg 產生（帶標題、演出者、位置、封面），清除之後用 ffprobe 確認標籤不見，用 `ffmpeg -f md5` 比對解碼後的聲音與影像跟原檔相同。

## 壓縮檔與其他格式

| 格式 | 做法 |
|---|---|
| ZIP（`archive.ts`） | 重新打包：時間統一、不寫附加欄位（Unix 的使用者 ID、精確的時間）與註解。`__MACOSX`、`._` 開頭的檔案、`.DS_Store`、`Thumbs.db` 拿掉（macOS 的延伸屬性常帶著下載來源的網址，`Thumbs.db` 存著圖片的縮圖），裡面的照片、文件與影音一起清除 |
| TAR（`tar.ts`） | 擁有者改成 0 與空白、時間清成零，pax 延伸標頭只留檔名、連結、大小與稀疏檔的欄位，權限保留，系統檔拿掉，裡面的檔案一起清除 |
| gzip（`gzip.ts`） | 標頭的原始檔名、時間與註解拿掉，解壓縮之後交給裡面的格式（通常是 TAR）再壓縮回去 |
| EPUB（`epub.ts`） | OPF 的 metadata 只留書名、語言與識別碼，識別碼換成隨機的 UUID（有字型混淆時不換），目錄的作者、內文的 meta 與註解、`iTunesMetadata.plist` 拿掉，有 DRM 的不處理 |
| 種子檔（`torrent.ts`） | 只留 `info`、tracker 與 web seed，建立的程式、時間、註解與發布者拿掉。`info` 一個位元組都不動，種子的識別碼不變 |
| HTML（`html.ts`） | 註解（另存網頁時的 `saved from url=`）與不影響顯示的 meta 拿掉，script、style 裡的內容不動。用 latin1 讀寫，Big5 的網頁不會改壞 |

ZIP 類的格式依序判斷：Office、ODF、EPUB，都不是才當成一般的壓縮檔。有巨集的 Office 文件與 ODF 範本不當成壓縮檔，免得只清了外殼、裡面的作者沒動。下載時壓縮檔沿用原本的副檔名（cbz、jar、tar.gz）。

CSS 沒有可靠的檔頭可以判斷格式，暫時不處理。

## HEIC

iPhone 預設拍出來的是 HEIC，在網頁上選照片時交出來的也是原本的 HEIC，不會自動轉成 JPEG。

- 中繼資料：`src/tools/strip-metadata/heif.ts` 解析 HEIF 的 box 結構，原地把 EXIF 與 XMP 換成空白的內容，長度與結構不變，所有瀏覽器都能用
- 解碼：Safari 能直接顯示。Brave、Chrome、Firefox 不能，`decodeImage()` 在內建解碼失敗、而且檔案是 HEIC 時，才下載 libheif（`src/ui/heif-wasm.ts`，WASM 壓縮後約 490 KB）。預覽、遮蔽、讀取 QR code 與轉成 JPEG 都靠它
- 授權：libheif 與 HEVC 解碼器 libde265 都是 LGPL-3.0。原封不動使用，打包成獨立的檔案，跟工作台的程式分開，授權與原始碼來源寫在 `licenses/libheif.txt`
- CSP：編譯 WebAssembly 需要 `script-src` 加上 `'wasm-unsafe-eval'`，它不會開放 JavaScript 的 `eval`
- 遮蔽與轉檔的輸出是 JPEG，瀏覽器裡沒有辦法編碼 HEIC

## Logo、圖示與配色

照社群的[品牌素材](https://anoni.net/brand/)，配色與社群首頁的 `static/css/site.css` 用同一組數值：

- 頁首的排版跟新聞導讀一致（2026-10-16 起）：anoni.net 字標、分隔線、產品名稱，右邊是回到桌面與清空暫存區。語系切換只放在頁尾，工具不常換語系，手機上的第二列也少一個可能按錯的按鈕。底色維持工作台的 `--brand-cyan-50` 淡藍，讀者換到工作台時看得出換了網站，深色模式改用比背景亮一階的藍灰。字標照品牌素材頁的用法，淺色底用 tonal 版（`public/logo-wordmark-tonal.svg`），深色模式用 `<picture>` 換成白色版（`public/logo-wordmark-white.svg`），兩份都跟社群首頁的 `static/brand/` 同一份
- 回到桌面與清空暫存區並排很容易按錯，清空又會一次放掉所有檔案、沒有辦法復原：清空用紅色（`--danger-text`，在淡藍底上也有 4.5:1）、跟回到桌面隔開一段距離，第一次按下只變成紅底的「再按一次清空」，4 秒內再按才清空。確認時拿掉圖示，按鈕的寬度跟原本相近，版面不會跳動。窄螢幕時操作換到第二列並靠右
- 頁首下方的提示（有新版本、已換上新版本）外層用 `frame` 留白，提示框本身才有邊框，窄螢幕上不會貼齊螢幕邊緣
- 網站圖示是 `public/favicon.svg`（V3 cyan tonal，三個六角形），跟社群首頁的 `static/favicon.svg` 同一份
- 主色只用 `--brand-cyan-*`，灰階用品牌的中性色，深色模式的背景是 `#00202d`
- 工具的圖示用 Material Design Icons，跟文件站小工具區的同一個工具一致，路徑內嵌在 `src/ui/icon-paths.ts`，授權全文在 `licenses/material-design-icons.txt`
- 圖示圈的顏色照品牌素材頁的「圖示的分類色」：跟個人隱私有關的用 `--cat-privacy`，處理機敏資料與密碼的用 `--cat-secure`。新增工具時在 `src/ui/tool-meta.ts` 指定圖示與類別，`tests/unit/tool-meta.spec.ts` 會檢查

主畫面用的 PNG 圖示（`public/icons/`）由 `node scripts/make-icons.mjs` 從 `public/favicon.svg` 產生，進版控，logo 沒有改就不必重新產生。iPhone 的「加入主畫面」只吃 PNG，Android 與 Brave 的安裝讀 `public/manifest.webmanifest`。

## 介面文字

字串集中在 `src/i18n/`，元件裡不寫死文字。正體中文（`zh-TW.ts`）是原稿，簡體中文（`zh-CN.ts`）與英文（`en.ts`）的鍵與變數必須跟它一致，`tests/unit/i18n.spec.ts` 會檢查。列舉用 `list()`，中文用頓號、英文用逗號。

- 語系由網址決定，不用 cookie 或 localStorage 記住。頁尾切換語系時不重新載入（`switchLocale`），暫存區的檔案留著
- 瀏覽器的語言清單裡沒有目前的語系時，頁首下方建議換成清單裡第一個認得的語系，文字用建議的那個語系寫（`src/ui/LocaleHint.tsx`，對應規則在 `src/i18n/suggest.ts`，有單元測試）。不自動轉址，關掉的狀態只在記憶體裡：站內換頁不再出現，重新整理或重新打開會再出現一次。只有 `zh` 分不出字系，不猜。onion 版不顯示，Tor Browser 一律回報英文。瀏覽器測試預設把語言設成 `zh-TW`（`playwright.config.ts`），測這個提示的另外指定
- 文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)，品牌寫成小寫的 `anoni.net`。三個語系各照各的規則（英文另有一套），檢查時把字串放在 `docs/zh-CN/`、`docs/en/` 這樣的路徑底下，linter 才會套用該語系的規則
- 簡體版的用詞跟著文件站簡體版：元数据、遮蔽、复制、生成器、识别、个资、截图、社区、账号

## 規劃

產品規劃記錄在社群的工作區，還沒有公開。目前完成第一階段：桌面、檔案暫存區，以及清除中繼資料（JPEG、PNG、HEIC、AVIF、WebP、GIF、TIFF、SVG、BMP、PNM、JPEG XL，Word、Excel、PowerPoint、LibreOffice 文件與 PDF，MP3、M4A、MP4、MOV、WAV、AVI、FLAC、Ogg、Opus、MKV、WebM，ZIP、TAR、gzip、EPUB、種子檔、HTML）、遮蔽（圖片與 PDF，可以自動找人臉與個資）、縮成常見尺寸、列印追蹤點、PDF 頁面選取、查證收到的檔案、影片的關鍵影格、文件開啟前檢查、信件檢查、下載的軟體驗證、寫作習慣檢查、逐字稿、加密與解密（檔案與一段文字）、面對面傳送、age 金鑰產生器、QR code 產生器與讀取、網址檢查、密語與密碼產生器，可以下載與系統分享，一次處理多個檔案，也可以離線使用。2026-10 起部署在 `anoni.net/gears/`（見上方「部署」）。

## 第三方資料

讀者從頁尾的「授權與來源」打開授權頁（`/gears/licenses/`，`src/ui/Licenses.tsx`，頁面清單在 `src/pages.ts`）。`licenses/` 底下的授權全文用 `?url` 匯入，跟著建置一起輸出（檔名帶雜湊），service worker 也會存起來，離線也能看。工作台自己的 `LICENSE` 沒有副檔名，伺服器會當成二進位檔，所以直接展開在頁面上。新增 `licenses/` 的檔案時，在 `Licenses.tsx` 的 `ENTRIES` 加一筆，三個語系加上 `licenses.<id>` 與 `licenses.<id>.desc`，`tests/e2e/licenses.spec.ts` 會比對每份授權全文。

逐字稿畫面最下面另有收起來的「使用的模型與授權」，每個模型分三行：原始模型與授權（`source`、`license`）、誰轉成 ONNX 檔（`repo`）、從哪裡下載（`host`）。`repo` 跟原始模型是同一個時當成社群自己轉檔，連到 assets.anoni.net 那個目錄的 `README.txt`，不同時連到轉檔者的 repo。新增模型時填好這幾欄就會出現。

- 密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware) `v0.4.0`，CC BY 4.0，畫面上標示出處
- 工具的圖示來自 [Material Design Icons](https://pictogrammers.com/library/mdi/)，Pictogrammers Free License
- HEIC 解碼器來自 [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5（libheif 與 libde265，LGPL-3.0），見 `licenses/libheif.txt`
- PDF 的解析與寫出用 [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1（MIT），見 `licenses/pdf-lib.txt`
- PDF 的遮蔽用 [pdf.js](https://github.com/mozilla/pdf.js)（pdfjs-dist 6.4.299，Apache-2.0）與它附帶的 CMap、標準字型與解碼器，見 `licenses/pdfjs.txt`
- 遮蔽的自動尋找用 [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 模型（MIT）與 [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.30.0（MIT）、[Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 與 tessdata_best 的語言資料（Apache-2.0），見 `licenses/redact-detect.txt`
- 逐字稿用 [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.1（Apache-2.0）、Whisper small 與 base 的 ONNX 檔（onnx-community，原始模型的模型卡標示 Apache-2.0）、讀者選擇之後從 Hugging Face 下載的 large-v3-turbo（模型卡標示 MIT）、分辨說話者用的 3D-Speaker CAM++（Apache-2.0，ONNX 檔取自 sherpa-onnx）、[opencc-js](https://github.com/nk2028/opencc-js) 1.4.2（MIT，字典 Apache-2.0），見 `licenses/transcribe.txt`
- 下載的軟體驗證用 [OpenPGP.js](https://github.com/openpgpjs/openpgpjs) 6.3.2（LGPL-3.0），內建 Tor Project 與 Tails 公開的簽章公鑰，見 `licenses/openpgp.txt`
- QR code 以外的條碼用 [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4（MIT），它是 [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp)（Apache-2.0）編譯成的 WebAssembly，見 `licenses/zxing.txt`
- 165 反詐騙清單見上方，部署時下載，不進版控

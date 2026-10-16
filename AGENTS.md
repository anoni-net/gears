# AGENTS.md

給參與開發的人與 AI 工具的說明。隱私工作台是匿名網路社群 anoni.net 的產品，網址是 `anoni.net/gears/`，在瀏覽器裡處理讀者要交出去的檔案，也替收到檔案的人整理可以查證的線索。文件站的小工具區（`anoni-net/docs` 的 `utils/`）是另一套，兩邊各自開發，不共用程式。

## 原則

- 預設在瀏覽器裡處理。之後若提供上傳到社群伺服器的選項，上傳前要在畫面上寫清楚檔案送到哪裡、誰看得到、保留多久、伺服器會不會留下紀錄，由讀者決定
- 上傳端點不經過 Cloudflare。Cloudflare 在邊緣解開 TLS，經過的檔案對它是明文
- 頁面能連線的對象寫死在 CSP 裡（`vite.config.ts`），新增任何對外連線都要改那裡，並在畫面上標示。目前唯一的例外是逐字稿的大模型從 Hugging Face 下載（見下方「逐字稿」），只開在伺服器送的 CSP 標頭，頁面的 meta 標籤仍然只有自己的網域
- 執行期的相依套件只有 `preact`、`qrcode-generator`（QR code 產生）、`jsqr`（QR code 讀取）、`age-encryption`（加密，連同它相依的 noble 系列）、`libheif-js`（HEIC 解碼，LGPL-3.0，見下方「HEIC」）、`pdf-lib`（PDF 的解析與寫出，見下方「文件」）、`pdfjs-dist`（PDF 的遮蔽，見下方「PDF 的遮蔽」），以及遮蔽的自動尋找用的 `onnxruntime-web` 與 `tesseract.js`（見下方「遮蔽的自動尋找」）、逐字稿用的 `@huggingface/transformers` 與 `opencc-js`（見下方「逐字稿」，分辨說話者用的 onnxruntime 是 Transformers.js 帶的那一份），以及查證計算 SHA-256 用的 `@noble/hashes`（age 加密原本就相依它，鎖定同一個版本，見下方「查證」）。新增套件前先想能不能自己寫，必要時鎖定確切的版本。工具用到的套件在打開工具時才載入
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
| `src/core/` | 位元組工具、工具模組的介面（`tool.ts`）、檔案暫存區（`tray.ts`）、不經過 canvas 的 PNG 編碼（`png-encode.ts`）、zip 的讀寫（`zip.ts`）、XML 的掃描與改寫（`xml.ts`） |
| `src/tools/` | 各個工具的純邏輯，一個工具一個目錄，在 `src/tools/index.ts` 登記 |
| `src/ui/`、`src/app.tsx` | 介面元件。`src/ui/registry.tsx` 登記從空白開始的工具用的元件，`src/ui/tool-meta.ts` 是每個工具的圖示與類別 |
| `src/router.ts` | 每個工具的網址 |
| `src/i18n/` | 介面字串：正體中文、簡體中文、英文 |
| `tests/unit/` | 在 Node 裡測純邏輯 |
| `tests/e2e/` | 在 Chromium、WebKit、Firefox 與 iPhone 尺寸上測整個流程 |
| `tests/helpers/` | 產生測試檔案的程式 |
| `public/` | 網站圖示、主畫面圖示與 manifest |
| `licenses/` | 第三方圖示、HEIC 解碼器、pdf-lib、pdf.js、自動尋找與逐字稿的授權全文 |

## 工具模組

工具分三種，都在 `src/tools/index.ts` 登記：

| | 處理檔案的工具（`fileTools`） | 需要編輯畫面的工具（`editorTools`） | 從空白開始的工具（`createTools`） |
|---|---|---|---|
| 例子 | 清除中繼資料 | 遮蔽、轉成 JPEG、選擇 PDF 的頁面、加密、解密、逐字稿 | QR code 產生器與讀取、網址檢查、密語與密碼產生器、age 金鑰產生器、加密文字、查證 |
| 介面 | `src/core/tool.ts` 的 `Tool` | `EditorTool`，編輯畫面登記在 `src/ui/registry.tsx` | `CreateTool`，元件登記在 `src/ui/registry.tsx` |
| 結果 | 暫存區裡那個檔案的新版本 | 同左，由 `tray.addVersion` 加入 | 產出檔案的放進暫存區，產出文字的只顯示在畫面上 |

`Tool` 宣告可處理的格式與 `resolves`（能處理哪幾種找到的資訊），`inspect` 列出檔案裡找到的資訊，`run` 輸入位元組、輸出新的位元組與處理報告。工具只用 `Uint8Array` 與純資料，不碰 DOM，網頁版、Web Worker 與之後的瀏覽器擴充套件都能直接呼叫。檔案畫面的工具列依 `resolves` 把能處理目前問題的工具標成建議。

需要編輯畫面的工具，讀者在畫面上操作，結果交給 `tray.addVersion`，一樣先解碼檢查再加成新版本。純邏輯（座標換算、加解密）仍然放在 `src/tools/<工具>/`，有單元測試。從工具的網址或任務進來時，選好檔案就直接打開編輯畫面。

從空白開始的工具，元件與它用到的函式庫在打開工具時才下載（`import()`），桌面維持輕量。產出的檔案用 `tray.add(files, 工具 id)` 放進暫存區，版本列會標出是哪個工具建立的。要打開另一個工具並帶入內容（例如把讀到的網址交給網址檢查）用 `onOpenTool`。

新增工具的步驟：

1. 純邏輯放 `src/tools/<工具>/`，在 `src/tools/index.ts` 加進其中一份清單
2. 編輯畫面或從空白開始的元件登記在 `src/ui/registry.tsx`
3. 在三個語系檔加上 `tool.<id>`、`tool.<id>.desc`、`meta.<id>.title` 與 `meta.<id>.description`，會在暫存區留下版本的工具另外加 `file.version.<id>`，用到新的 `FindingCode` 或 `SegmentCode` 時也要加，`tests/unit/i18n.spec.ts` 會檢查
4. 單元測試放 `tests/unit/`，流程測試放 `tests/e2e/`

暫存區有兩個以上的檔案時，下方可以一次清除全部的中繼資料（`tray.applyAll`，逐一處理，一個失敗不影響其他的），也可以把每個檔案的最新版本下載成一個壓縮檔（`src/ui/BatchActions.tsx`）。壓縮檔裡的檔名跟單檔下載一樣用 `gears-第幾個`（`src/ui/output-name.ts`），在記憶體裡組成，超過 512 MB 的部分請讀者個別下載。

暫存區每次處理都產生新版本並保留原檔。處理完的影像會先實際解碼一次（`src/state.ts`），解不開就放棄這次的結果。加密檔由加密工具自己驗證，用密語加密時會用同一組密語解密一次。

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
- 編輯痕跡：照片內嵌的縮圖跟主圖並排、XMP 的編輯紀錄、Office 與 LibreOffice 的修訂次數與編輯時間、PDF 的數位簽章（只看簽章涵蓋到哪裡，不驗證憑證），以及 PDF 的舊版本：每一個 `%%EOF` 是一次存檔的結尾，切到那裡讀得出來就是一個版本，可以取出來放進暫存區（來源記成 `verify`，也算進這一批）。線性化的 PDF 第一個 `%%EOF` 不算
- 需要留意的地方（`summary.ts`）：內容相同、副檔名跟格式不符、修改早於建立、拍攝時間跟 GPS 時間對不上（有時區時差 5 分鐘以上，沒有時區時差距不接近任何真實的時區）、記錄的軟體是影像編輯軟體、簽章之後還有加入內容、PDF 有舊版本

只給線索，不下真假的判決：中繼資料很容易改，有矛盾不代表造假，沒有矛盾也不代表是真的，畫面與匯出的紀錄開頭都寫明。誤差分析與 AI 生成偵測的分數常被誤讀成判決，不做。也不提供填入假的中繼資料，假資料跟檔案的解析度、壓縮參數與內部結構對不上，比空白更顯眼。

查證紀錄可以下載成 Markdown，開頭是產生的時間（裝置的時鐘與時區）與建置的 commit，接著是雜湊值。也可以放進暫存區（來源記成 `verify-report`，不算進這一批），接著用 age 加密。紀錄裡有從檔案讀出來的人名與位置，畫面上提醒讀者小心保管。

在查證的畫面加入檔案時留在查證的畫面（`src/app.tsx` 的 `addFiles`），其他從空白開始的工具加入檔案時回到桌面。

照片讀 EXIF（`extractExif` 支援的格式，`parseExif` 補上了拍攝、數位化、修改三種時間與各自的時區、GPS 的 UTC 時間與縮圖的位置），PDF 用 pdf-lib 讀文件資訊、XMP、簽章與舊版本，Office 讀 `docProps/core.xml` 與 `app.xml`，LibreOffice 讀 `meta.xml`，XMP 在其他格式裡用 `<x:xmpmeta` 搜尋。其他格式用加入暫存區時清除中繼資料的檢查結果，MP4、MOV、M4A 的時間是 UTC。單元測試在 `tests/unit/verify.spec.ts`。本機另外用 Pillow 寫入 EXIF 的照片、python-docx 產生的 Word 與 Chromium 列印的 PDF 驗證過。

## 逐字稿

把錄音或影片的聲音轉成帶時間的段落，以華語為主（`src/ui/TranscribeEditor.tsx`）。結果不是錄音的新版本，TXT 與 SRT 另外放進暫存區，也可以直接下載或複製。逐字稿是草稿，畫面上寫明要對照錄音校對。

- 模型：Whisper small（252 MB，預設）與 base（80 MB），onnx-community 的 8 位元量化版，另外可以選從 Hugging Face 下載的 large-v3-turbo（見下方），讀者自己選。tiny 對華語幾乎不能用（實測字錯率 98%，會掉進英文的重複迴圈），不提供。用魯迅〈阿Q正傳〉的 LibriVox 朗讀實測字錯率：small 約 24%、base 約 56%
- 模型不進版控，`node scripts/fetch-whisper.mjs` 從 Hugging Face 下載到 `public/models/whisper/`（CPU 與 WebGPU 兩組，CI 加 `--no-webgpu` 只下載 CPU 用的），版本與每個檔案的 SHA-256 寫在 `src/tools/transcribe/models.json`。部署前先執行一次，網頁只從自己的網域載入
- large-v3-turbo（4 位元量化版，約 760 MB）從 m6 送出的流量太重，`models.json` 標成 `remote`，讀者選擇之後由網頁直接從 Hugging Face 下載（`src/tools/transcribe/remote.ts`）。選了還沒下載的大模型時，畫面先說明 Hugging Face 看得到 IP 位址、瀏覽器與下載了哪個模型，按鈕寫成「從 Hugging Face 下載並開始」。網址鎖定 commit，每個檔案讀完比對 SHA-256，對不上就不存。請求不帶 cookie 與 Referer。下載好的檔案存進同一個 `gears-models` 快取，網址用自己網域的路徑，「已下載」與刪除跟 small、base 一樣處理。Transformers.js 會把 `env.fetch` 的錯誤換成「找不到檔案」，Worker 另外記下下載失敗的原因
- 用同一段朗讀實測（Node），large-v3-turbo 的字錯率約 22%，small 約 28%，辨識時間約 small 的 1.7 倍。q8 版的字錯率相近、檔案大 300 多 MB，所以用 q4
- CSP：伺服器送的標頭多開 `https://huggingface.co/<repo>/resolve/<commit>/`（只有下載的路徑，不含上傳用的 API）與 `https://*.hf.co`（下載會轉址到 CDN，轉址之後 CSP 只比對主機）。頁面同時有標頭與 meta 標籤時兩者都要符合，所以頁面本身仍然只能連自己的網域，只有 Worker 連得到 Hugging Face。瀏覽器測試攔下 Hugging Face 的請求，回一份內容不對的檔案，確認會停下來、不存進快取
- 推論在 Web Worker（`src/ui/transcribe.worker.ts`）用 Transformers.js 執行。關掉 Hugging Face 的下載（`allowRemoteModels`）與 Transformers.js 自己的快取（`useBrowserCache`、`useWasmCache`），請求不寫 HTTP 快取（`cache: "no-store"`，模型檔最大 157 MB，無痕視窗的記憶體快取寫不下時整個請求會失敗）
- Transformers.js 帶著自己的 onnxruntime-web（1.31.0 的開發版，跟找人臉的 1.30.0 分開），不指定的話會從 jsDelivr 的 CDN 載入 WebAssembly。Worker 不受頁面 meta 標籤的 CSP 約束，請求真的會送出去，所以用 `?url` 匯入它那一份 WebAssembly，從自己的網域載入。預覽伺服器也用標頭送 CSP，部署時 nginx 一樣要送（見下方「部署」）
- 語音偵測：Whisper 在靜音上會產生重複的幻覺文字（實測 base 對 5 秒的靜音輸出「你懂你懂……」直到長度上限）。先用音量找出說話的段落，裝成不超過 30 秒的片段（裝得下就連同停頓放在一起，Whisper 不管片段多短都補到 30 秒再算），只把這些片段送進模型。每個片段依長度限制最多產生的詞元數。整理結果時拿掉靜音段落、短短一段的字幕標語（「字幕製作」、「請不吝點讚」這類），收掉重複的迴圈（`src/tools/transcribe/segments.ts`，有單元測試）
- 語言由讀者選（`src/tools/transcribe/languages.ts`）：華語、英語、日語、韓語、越南語、泰語、印尼語、馬來語、菲律賓語。Transformers.js 4.3.1 沒有實作 Whisper 的語言偵測，不指定語言時一律當成英文，華語的錄音會直接翻成英文（原本的「自動判斷」就是這樣壞掉的）。粵語在 Transformers.js 沒有語言代碼，等另外的模型
- 簡體轉台灣正體與台灣慣用詞：`opencc-js` 的 `cn2t`（cn → twp），在 Worker 裡用到時才載入。只在選華語時轉，半形標點換成全形也是，日文的漢字與其他語言的標點不動
- 同時使用的 CPU 核心讀者自己選（1、2、4、8、12、16），預設值依瀏覽器回報的核心數決定（`src/tools/transcribe/threads.ts`，有單元測試）。多執行緒要頁面在 cross-origin isolation 底下（COOP 與 COEP 標頭），換核心數時換一個新的 Worker（onnxruntime 第一次載入時就決定了執行緒數）。實測差距很大：15 核心的 MacBook Pro 上，同一段錄音 4 個核心要 40 分鐘、8 個 8 分鐘、12 個 4 分鐘（這台開發機在其他程式同時執行、負載很高時量到的差距小很多，不準）。`navigator.hardwareConcurrency` 只會比實際少：Brave 回報 2 到真實數字之間的隨機數，Safari 桌機最多回報 8、iPhone 一律回報 2，Firefox 防指紋時固定回報 2。所以回報 12 以上就用 12，Chrome 這類回報真實數字的用不超過它的最大選項，數字不可信的用 8，iPhone、iPad 用 4，Firefox 用 1（見下方推論環境停住的說明）
- 切成好幾段的模型檔（`src/tools/transcribe/parts.ts`，有單元測試）：自己轉檔的大模型放在 assets.anoni.net，前面是 Cloudflare，免費方案的單一檔案快取上限是 512 MB。超過的檔案用 `node scripts/split-model.mjs <檔案> [每段的 MB]` 切成 `<檔名>.part0`、`.part1`…（預設每段 400 MB），把印出的內容填進 `models.json` 該模型的 `parts`。Worker 依序下載每一段、比對 SHA-256，直接寫進預先配置好的一整塊記憶體，接回來的就是原本的檔案，再交給 Transformers.js。「已下載」看最後一段在不在快取裡
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

## 離線使用

第一次開啟之後，沒有網路也能使用。service worker 的範本在 `src/sw/sw-template.js`，建置時 `vite.config.ts` 的 `serviceWorker()` 列出 `dist/` 的檔案、算出版本（所有檔案內容的雜湊），輸出成 `/gears/sw.js`。

- 安裝時先存頁面、程式、圖示與 165 清單，約 6 MB，其中 PDF 遮蔽的 pdf.js 約 1.7 MB（壓縮後約 500 KB）。人臉與文字辨識的模型與 WebAssembly、pdf.js 的 CMap 與字型（`vendor/`、`models/`、`assets/ort-wasm-*`）用到時才存
- 逐字稿的 Whisper 模型存在另一個不隨版本清掉的快取（`gears-models`），換新版本時不必重新下載 80 到 250 MB。網址帶著模型的版本，清單以外的在新版本接手時刪掉。畫面上標出已下載的模型，可以刪除
- 只存工作台自己的檔案。讀者放進暫存區的檔案只在記憶體裡，不經過 service worker，也不寫進快取
- 有新版本時畫面上方提示，讀者按「重新載入」才換上，避免同一個分頁混用新舊程式。重新載入會清空暫存區，提示裡寫明
- 按下「重新載入」之後按鈕改成「更新中…」。新版本接手時收到 `controllerchange` 就重新載入，4 秒內沒收到（等著的那一版已經被更新的一版取代，或瀏覽器沒有切換）也直接重新載入，按鈕不會停在那裡。重新載入之後顯示「已換上新版本」，這個記號放在 `history.state`，不寫進 localStorage
- 換版本的測試自己起一個靜態伺服器提供 `dist/`，瀏覽器檢查更新的請求 `page.route` 攔不到
- 比對快取時忽略 `Vary`：模組腳本的請求帶著 `Origin`，伺服器回應的 `Vary: Origin` 會讓預先存的那份對不上
- 部署時 `sw.js` 要設定不快取（`Cache-Control: no-cache`），瀏覽器才查得到新版本
- 瀏覽器測試預設擋掉 service worker（`playwright.config.ts`），它接手的請求 `page.route` 攔不到。離線的測試（`tests/e2e/offline.spec.ts`）自己打開，只在 Chromium 執行

## 部署

- 部署前執行 `node scripts/fetch-165.mjs` 與 `node scripts/fetch-whisper.mjs`（Whisper small、base 與分辨說話者的 CAM++），再建置
- 伺服器要送 `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: require-corp`（逐字稿的多執行緒），以及 `vite.config.ts` 的 `HEADER_CSP`（`npx vite preview` 送出的就是它，Web Worker 吃標頭的 CSP，不吃頁面的 meta 標籤）。換大模型的版本時 CSP 裡的 commit 跟著變，nginx 的設定要一起改。service worker 預先存的檔案連當時的標頭一起存，所以先改 nginx 再部署新版本，順序反過來的話，讀者的 Worker 會一直帶著舊的 CSP，直到下一次換版本
- `.wasm` 要用 `application/wasm` 送出並開壓縮，onnxruntime 的 WebAssembly 壓縮後約小四分之三
- `sw.js` 不快取（見上方「離線使用」）

## 165 反詐騙清單

網址檢查比對 165 反詐騙諮詢專線公開的「遭停止解析涉詐網站」清單（政府資料開放平台資料集 176455，內政部警政署，政府資料開放授權條款第 1 版），每月更新。

```bash
node scripts/fetch-165.mjs   # 下載並整理成 public/data/165.txt
```

檔案約 1.5 MB，不進版控，部署時先執行一次再建置。沒有這個檔案時建置照樣成功，網址檢查顯示清單無法載入，其他檢查不受影響。瀏覽器測試攔截這個請求，改給固定的測試清單，結果不隨每月的資料變動。

## 網址

每個工具有自己的網址，例如 `/gears/qrcode/`，簡體中文與英文在前面加上 `zh-cn/`、`en/`（`/gears/en/qrcode/`）。建置時 `vite.config.ts` 替每個語系、每個工具產生一份 HTML，`lang`、標題、描述與 `noscript` 取自該語系的字串，並列出其他語系的 `hreflang`。內容跟首頁相同，打開之後由 `src/router.ts` 判斷語系與要顯示哪個工具。主機不需要轉址設定。

## 其他欄位的內容

檢查時找到的「其他程式自訂的欄位或識別碼」也列出名稱與內容（`src/tools/strip-metadata/preview.ts`），廠商的私有區段常藏著序號、帳號或裝置的識別碼。文字直接顯示，二進位資料抽出連續 4 個字元以上的可讀字串，抽不到就顯示開頭的 16 個位元組。同一種資訊的不同值逐行列出（`mergeFindings`），超過 8 個只列前 8 個。

## 介面上的限制

- 能不用 canvas 輸出圖檔就不用。Brave 預設會擾動 canvas 讀出來的像素，QR code 的 PNG 由 `src/core/png-encode.ts` 直接寫位元組。遮蔽與 QR code 讀取必須解碼影像，只能用 canvas：遮蔽輸出後抽查每個框是否夠黑，門檻容許這點雜訊。QR code 讀取對雜訊不敏感
- 站內導覽不用一般的 `<a href>`。一般的連結會重新載入頁面，暫存區只在記憶體裡，會整個清空。改用 `src/router.ts` 的 `navigate()`，外觀要像連結時用 `button.link`
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

照片與圖檔不進 repo，品牌圖示（`public/icons/`）例外。單元測試用 `tests/helpers/fixtures.ts` 組出結構完整的檔案。瀏覽器測試先用 canvas 產生一張可以解碼的圖，再塞進中繼資料。

HEIC 有兩種測試檔。單元測試在測試裡組出結構完整、不能解碼的檔案。能解碼的真 HEIC 由 `tests/global-setup.ts` 在瀏覽器測試開始前呼叫 `scripts/make-test-images.py`，用 pillow-heif 產生到 `tests/.generated/`（不進版控）。有 `uv` 就用 `uv run --with pillow-heif==1.8.1`，CI 用 `astral-sh/setup-uv` 安裝。產生不了時，用到真 HEIC 的測試會略過。

QR code 的測試把產生的 PNG 解碼回像素，用 `jsQR` 讀出文字，跟輸入比對，中文與 Wi-Fi 的特殊字元都要測。編碼寫錯的典型後果是掃得出來、內容卻錯。

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

- logo 是 V3 cyan tonal（三個六角形），頁首內嵌在 `src/ui/Logo.tsx`，網站圖示是 `public/favicon.svg`，兩者跟社群首頁的 `static/favicon.svg` 同一份
- 頁首用 `--brand-cyan-50` 淡藍底，在社群首頁的白底與文件站的 `cyan-800` 之間，讀者換到工作台時看得出換了網站。深色模式改用比背景亮一階的藍灰
- 主色只用 `--brand-cyan-*`，灰階用品牌的中性色，深色模式的背景是 `#00202d`
- 工具的圖示用 Material Design Icons，跟文件站小工具區的同一個工具一致，路徑內嵌在 `src/ui/icon-paths.ts`，授權全文在 `licenses/material-design-icons.txt`
- 圖示圈的顏色照品牌素材頁的「圖示的分類色」：跟個人隱私有關的用 `--cat-privacy`，處理機敏資料與密碼的用 `--cat-secure`。新增工具時在 `src/ui/tool-meta.ts` 指定圖示與類別，`tests/unit/tool-meta.spec.ts` 會檢查

主畫面用的 PNG 圖示（`public/icons/`）由 `node scripts/make-icons.mjs` 從 `public/favicon.svg` 產生，進版控，logo 沒有改就不必重新產生。iPhone 的「加入主畫面」只吃 PNG，Android 與 Brave 的安裝讀 `public/manifest.webmanifest`。

## 介面文字

字串集中在 `src/i18n/`，元件裡不寫死文字。正體中文（`zh-TW.ts`）是原稿，簡體中文（`zh-CN.ts`）與英文（`en.ts`）的鍵與變數必須跟它一致，`tests/unit/i18n.spec.ts` 會檢查。列舉用 `list()`，中文用頓號、英文用逗號。

- 語系由網址決定，不用 cookie 或 localStorage 記住。頁尾切換語系時不重新載入（`switchLocale`），暫存區的檔案留著
- 文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)，品牌寫成小寫的 `anoni.net`。三個語系各照各的規則（英文另有一套），檢查時把字串放在 `docs/zh-CN/`、`docs/en/` 這樣的路徑底下，linter 才會套用該語系的規則
- 簡體版的用詞跟著文件站簡體版：元数据、遮蔽、复制、生成器、识别、个资、截图、社区、账号

## 規劃

產品規劃記錄在社群的工作區，還沒有公開。目前完成第一階段：桌面、檔案暫存區，以及清除中繼資料（JPEG、PNG、HEIC、AVIF、WebP、GIF、TIFF、SVG、BMP、PNM、JPEG XL，Word、Excel、PowerPoint、LibreOffice 文件與 PDF，MP3、M4A、MP4、MOV、WAV、AVI、FLAC、Ogg、Opus、MKV、WebM，ZIP、TAR、gzip、EPUB、種子檔、HTML）、遮蔽（圖片與 PDF，可以自動找人臉與個資）、選擇 PDF 的頁面、查證收到的檔案、逐字稿、加密與解密（檔案與一段文字）、age 金鑰產生器、QR code 產生器與讀取、網址檢查、密語與密碼產生器，可以下載與系統分享，一次處理多個檔案，也可以離線使用。部署到 `anoni.net/gears/` 是下一步。

## 第三方資料

- 密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware) `v0.4.0`，CC BY 4.0，畫面上標示出處
- 工具的圖示來自 [Material Design Icons](https://pictogrammers.com/library/mdi/)，Pictogrammers Free License
- HEIC 解碼器來自 [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5（libheif 與 libde265，LGPL-3.0），見 `licenses/libheif.txt`
- PDF 的解析與寫出用 [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1（MIT），見 `licenses/pdf-lib.txt`
- PDF 的遮蔽用 [pdf.js](https://github.com/mozilla/pdf.js)（pdfjs-dist 6.4.299，Apache-2.0）與它附帶的 CMap、標準字型與解碼器，見 `licenses/pdfjs.txt`
- 遮蔽的自動尋找用 [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 模型（MIT）與 [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.30.0（MIT）、[Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 與 tessdata_best 的語言資料（Apache-2.0），見 `licenses/redact-detect.txt`
- 逐字稿用 [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.1（Apache-2.0）、Whisper small 與 base 的 ONNX 檔（onnx-community，原始模型的模型卡標示 Apache-2.0）、讀者選擇之後從 Hugging Face 下載的 large-v3-turbo（模型卡標示 MIT）、分辨說話者用的 3D-Speaker CAM++（Apache-2.0，ONNX 檔取自 sherpa-onnx）、[opencc-js](https://github.com/nk2028/opencc-js) 1.4.2（MIT，字典 Apache-2.0），見 `licenses/transcribe.txt`
- 165 反詐騙清單見上方，部署時下載，不進版控

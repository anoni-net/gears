# AGENTS.md

給參與開發的人與 AI 工具的說明。隱私工作台是匿名網路社群 anoni.net 的產品，網址是 `anoni.net/gears/`，在瀏覽器裡處理讀者要交出去的檔案。文件站的小工具區（`anoni-net/docs` 的 `utils/`）是另一套，兩邊各自開發，不共用程式。

## 原則

- 預設在瀏覽器裡處理。之後若提供上傳到社群伺服器的選項，上傳前要在畫面上寫清楚檔案送到哪裡、誰看得到、保留多久、伺服器會不會留下紀錄，由讀者決定
- 上傳端點不經過 Cloudflare。Cloudflare 在邊緣解開 TLS，經過的檔案對它是明文
- 頁面能連線的對象寫死在 CSP 裡（`vite.config.ts`），新增任何對外連線都要改那裡，並在畫面上標示
- 執行期的相依套件只有 `preact`、`qrcode-generator`（QR code 產生）、`jsqr`（QR code 讀取）、`age-encryption`（加密，連同它相依的 noble 系列）、`libheif-js`（HEIC 解碼，LGPL-3.0，見下方「HEIC」）、`pdf-lib`（PDF 的解析與寫出，見下方「文件」），以及遮蔽的自動尋找用的 `onnxruntime-web` 與 `tesseract.js`（見下方「遮蔽的自動尋找」）。新增套件前先想能不能自己寫，必要時鎖定確切的版本。工具用到的套件在打開工具時才載入
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
| `licenses/` | 第三方圖示、HEIC 解碼器、pdf-lib 與自動尋找的授權全文 |

## 工具模組

工具分三種，都在 `src/tools/index.ts` 登記：

| | 處理檔案的工具（`fileTools`） | 需要編輯畫面的工具（`editorTools`） | 從空白開始的工具（`createTools`） |
|---|---|---|---|
| 例子 | 清除中繼資料 | 遮蔽、轉成 JPEG、加密、解密 | QR code 產生器與讀取、網址檢查、密語與密碼產生器、age 金鑰產生器、加密文字 |
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

Tesseract 的 WebAssembly 會把執行紀錄寫到標準錯誤輸出，瀏覽器當成 `console.error`。瀏覽器測試的守門程式（`tests/e2e/guard.ts`）把這種已知的訊息列為例外。

## 離線使用

第一次開啟之後，沒有網路也能使用。service worker 的範本在 `src/sw/sw-template.js`，建置時 `vite.config.ts` 的 `serviceWorker()` 列出 `dist/` 的檔案、算出版本（所有檔案內容的雜湊），輸出成 `/gears/sw.js`。

- 安裝時先存頁面、程式、圖示與 165 清單，約 4 MB。人臉與文字辨識的模型與 WebAssembly（`vendor/`、`models/`、`assets/ort-wasm-*`）用到時才存
- 只存工作台自己的檔案。讀者放進暫存區的檔案只在記憶體裡，不經過 service worker，也不寫進快取
- 有新版本時畫面上方提示，讀者按「重新載入」才換上，避免同一個分頁混用新舊程式。重新載入會清空暫存區，提示裡寫明
- 按下「重新載入」之後按鈕改成「更新中…」。新版本接手時收到 `controllerchange` 就重新載入，4 秒內沒收到（等著的那一版已經被更新的一版取代，或瀏覽器沒有切換）也直接重新載入，按鈕不會停在那裡。重新載入之後顯示「已換上新版本」，這個記號放在 `history.state`，不寫進 localStorage
- 換版本的測試自己起一個靜態伺服器提供 `dist/`，瀏覽器檢查更新的請求 `page.route` 攔不到
- 比對快取時忽略 `Vary`：模組腳本的請求帶著 `Origin`，伺服器回應的 `Vary: Origin` 會讓預先存的那份對不上
- 部署時 `sw.js` 要設定不快取（`Cache-Control: no-cache`），瀏覽器才查得到新版本
- 瀏覽器測試預設擋掉 service worker（`playwright.config.ts`），它接手的請求 `page.route` 攔不到。離線的測試（`tests/e2e/offline.spec.ts`）自己打開，只在 Chromium 執行

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

產品規劃記錄在社群的工作區，還沒有公開。目前完成第一階段：桌面、檔案暫存區，以及清除中繼資料（JPEG、PNG、HEIC、AVIF、WebP、GIF、TIFF、SVG、BMP、PNM、JPEG XL，Word、Excel、PowerPoint、LibreOffice 文件與 PDF，MP3、M4A、MP4、MOV、WAV、AVI、FLAC、Ogg、Opus、MKV、WebM，ZIP、TAR、gzip、EPUB、種子檔、HTML）、遮蔽（可以自動找人臉與個資）、加密與解密（檔案與一段文字）、age 金鑰產生器、QR code 產生器與讀取、網址檢查、密語與密碼產生器，可以下載與系統分享，一次處理多個檔案，也可以離線使用。部署到 `anoni.net/gears/` 是下一步。

## 第三方資料

- 密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware) `v0.4.0`，CC BY 4.0，畫面上標示出處
- 工具的圖示來自 [Material Design Icons](https://pictogrammers.com/library/mdi/)，Pictogrammers Free License
- HEIC 解碼器來自 [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5（libheif 與 libde265，LGPL-3.0），見 `licenses/libheif.txt`
- PDF 的解析與寫出用 [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1（MIT），見 `licenses/pdf-lib.txt`
- 遮蔽的自動尋找用 [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 模型（MIT）與 [onnxruntime-web](https://github.com/microsoft/onnxruntime) 1.30.0（MIT）、[Tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 與 tessdata_best 的語言資料（Apache-2.0），見 `licenses/redact-detect.txt`
- 165 反詐騙清單見上方，部署時下載，不進版控

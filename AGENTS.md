# AGENTS.md

給參與開發的人與 AI 工具的說明。隱私工作台是匿名網路社群 anoni.net 的產品，網址是 `anoni.net/gears/`，在瀏覽器裡處理讀者要交出去的檔案。文件站的小工具區（`anoni-net/docs` 的 `utils/`）是另一套，兩邊各自開發，不共用程式。

## 原則

- 預設在瀏覽器裡處理。之後若提供上傳到社群伺服器的選項，上傳前要在畫面上寫清楚檔案送到哪裡、誰看得到、保留多久、伺服器會不會留下紀錄，由讀者決定
- 上傳端點不經過 Cloudflare。Cloudflare 在邊緣解開 TLS，經過的檔案對它是明文
- 頁面能連線的對象寫死在 CSP 裡（`vite.config.ts`），新增任何對外連線都要改那裡，並在畫面上標示
- 執行期的相依套件只有 `preact`、`qrcode-generator`（QR code 產生）、`jsqr`（QR code 讀取）、`age-encryption`（加密，連同它相依的 noble 系列）、`libheif-js`（HEIC 解碼，LGPL-3.0，見下方「HEIC」）與 `pdf-lib`（PDF 的解析與寫出，見下方「文件」）。新增套件前先想能不能自己寫，必要時鎖定確切的版本。工具用到的套件在打開工具時才載入
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
| `src/i18n/` | 介面字串，第一版只有正體中文 |
| `tests/unit/` | 在 Node 裡測純邏輯 |
| `tests/e2e/` | 在 Chromium、WebKit、Firefox 與 iPhone 尺寸上測整個流程 |
| `tests/helpers/` | 產生測試檔案的程式 |
| `public/` | 網站圖示、主畫面圖示與 manifest |
| `licenses/` | 第三方圖示、HEIC 解碼器與 pdf-lib 的授權全文 |

## 工具模組

工具分三種，都在 `src/tools/index.ts` 登記：

| | 處理檔案的工具（`fileTools`） | 需要編輯畫面的工具（`editorTools`） | 從空白開始的工具（`createTools`） |
|---|---|---|---|
| 例子 | 清除中繼資料 | 遮蔽、轉成 JPEG、加密、解密 | QR code 產生器與讀取、網址檢查、密語與密碼產生器、age 金鑰產生器 |
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
- 站內導覽不用一般的 `<a href>`。一般的連結會重新載入頁面，暫存區只在記憶體裡，會整個清空。改用 `src/router.ts` 的 `navigate()`，外觀要像連結時用 `button.link`
- 解碼圖片一律用 `src/ui/image-decode.ts` 的 `decodeImage()`，不要直接呼叫 `createImageBitmap()`，HEIC 才會在不支援的瀏覽器上改用 libheif
- 不用 `<select>`。Linux 版 WebKit 建立下拉選單時，內部的樣式表會被 CSP 擋下，主控台留下錯誤。選項不多時改用攤開的選項按鈕，手機上也少點一下

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

驗證時在本機用 Pillow 產生帶中繼資料的真實檔案，清除之後再用 Pillow 解碼，確認像素與原檔相同。

## 文件

Office 與 LibreOffice 的文件都是 zip 包著一組 XML，`src/core/zip.ts` 用瀏覽器內建的 `DecompressionStream` 解壓縮，`src/core/xml.ts` 逐一讀出標籤，只改動規則指定的元素、屬性與文字，其餘照抄。重新打包時時間戳記統一成 1980-01-01，不寫附加欄位與註解，檔案的順序與壓縮方式維持原樣。

| 格式 | 拿掉或改寫 |
|---|---|
| docx、xlsx、pptx（`ooxml.ts`） | 文件摘要（作者、公司、時間、編輯時數）、自訂屬性與 `customXml`、預覽圖、印表機設定、敏感度標籤、數位簽章、Word 的 rsid 與文件識別碼、範本與合併列印來源、Excel 記下的存檔路徑、外部連結的路徑只留檔名，指向拿掉部件的關聯、`[Content_Types].xml` 與 `r:id` 一併修正 |
| odt、ods、odp、odg（`odf.ts`） | `meta.xml` 清空、`settings.xml` 的印表機與資料庫設定、預覽圖、數位簽章、rsid，manifest 跟著更新，第一個檔案仍是不壓縮的 `mimetype` |
| PDF（`pdf.ts`） | 文件資訊、XMP、文件識別碼、PieceInfo、數位簽章，重新寫出時只保留從文件目錄走得到的物件，增量更新留下的舊版本不會帶過去 |

三種格式都一樣的部分：

- 註解與追蹤修訂是讀者寫進去的內容，保留下來，作者改成 `Author`，時間拿掉或改成固定的值。檢查時列在「文件內容裡要留意的」，提醒讀者刪除的文字仍在檔案裡（`CONTENT_FINDINGS`，清除中繼資料的 `resolves` 不包含它們）
- 內嵌的圖片交給對應格式的處理程式，內嵌的 Office 文件也是，最多三層
- 加密的文件、有巨集的 Office 文件（docm 等）不處理

pdf-lib（MIT，相依的 pako、tslib 等也一起打包）壓縮後約 180 KB，打開 PDF 時才載入，授權全文在 `licenses/pdf-lib.txt`。透過 `src/tools/strip-metadata/pdf-lib.ts` 載入，建置出來的檔名才看得出用途。

單元測試用 `tests/helpers/documents.ts` 組出在各處都塞了秘密字串的文件，清除後逐一確認不在檔案裡、內文還在、套件內部的關聯前後一致。真實的檔案在本機用 python-docx、openpyxl、python-pptx 產生，再用 LibreOffice 轉成 ODF 與 PDF，清除之後用 LibreOffice 開啟並轉成 PDF，比對文字與原檔相同。

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

字串集中在 `src/i18n/zh-TW.ts`，元件裡不寫死文字。文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)，品牌寫成小寫的 `anoni.net`。

## 規劃

產品規劃記錄在社群的工作區，還沒有公開。目前完成第一階段：桌面、檔案暫存區，以及清除中繼資料（JPEG、PNG、HEIC、AVIF、WebP、GIF、TIFF、SVG、BMP、PNM、JPEG XL，Word、Excel、PowerPoint、LibreOffice 文件與 PDF）、遮蔽、加密與解密、age 金鑰產生器、QR code 產生器與讀取、網址檢查、密語與密碼產生器，可以下載與系統分享。部署到 `anoni.net/gears/` 是下一步。

## 第三方資料

- 密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware) `v0.4.0`，CC BY 4.0，畫面上標示出處
- 工具的圖示來自 [Material Design Icons](https://pictogrammers.com/library/mdi/)，Pictogrammers Free License
- HEIC 解碼器來自 [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.5（libheif 與 libde265，LGPL-3.0），見 `licenses/libheif.txt`
- PDF 的解析與寫出用 [pdf-lib](https://github.com/Hopding/pdf-lib) 1.17.1（MIT），見 `licenses/pdf-lib.txt`
- 165 反詐騙清單見上方，部署時下載，不進版控

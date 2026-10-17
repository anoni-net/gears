<a id="zh-tw"></a>

# gears

**正體中文** | [English](#en)

anoni.net Gears 檔案工作台，在瀏覽器裡處理要交出去的檔案：清除照片與文件的中繼資料、遮蔽畫面上的個資、加密之後再傳送。收到檔案時，也能整理出可以查證的線索。由[匿名網路社群 anoni.net](https://anoni.net/) 維護，網址是 <https://anoni.net/gears/>，用 Tor Browser 開啟 onion 版 <http://gears.anoninetru5tflukgfaehun7q6khowgmymcff3gtk5oyesqazhmfxtyd.onion/>。

第一版的工具：

- 清除照片的拍攝位置、手機型號與拍攝時間（JPEG、PNG、HEIC、WebP、GIF、TIFF 等）
- 清除 Word、Excel、PowerPoint、LibreOffice 文件與 PDF 的作者、公司、印表機與電腦上的路徑
- 清除手機影片的拍攝位置與手機型號，以及音樂與錄音的標籤與封面（MP4、MOV、MP3、WAV、FLAC、Ogg、MKV 等）
- 清除壓縮檔裡每個檔案的時間與擁有者、macOS 與 Windows 留下的系統檔，裡面的照片與文件一起清（ZIP、TAR、tar.gz），以及電子書、種子檔與另存的網頁
- 把 iPhone 的 HEIC 照片轉成 JPEG
- 遮蔽截圖與 PDF 上的名字、頭像與電話，可以自動找人臉與電話、Email 這類個資，也可以選擇保留拍攝資訊。PDF 遮蔽後每一頁轉成圖片，框起來的文字不會留在檔案裡
- 把照片縮成分享時常見的尺寸、用一般的參數重新壓縮，原始解析度與相機的壓縮設定不再透露手機機型
- 找出掃描或翻拍的紙本文件上，彩色雷射印表機印的淡黃色追蹤點，去掉淡黃色或轉成黑白
- 只交出 PDF 的其中幾頁，其他頁連同連到它們的連結、書籤與文件資訊一起拿掉
- 查證收到的檔案：雜湊值、時間線、裝置、作者與編輯痕跡，比對檔案之間的矛盾，PDF 的舊版本可以比對差異，匯出查證紀錄
- 影片的關鍵影格：從收到的影片挑出畫面明顯不同的幾格，存成圖片，拿去做反向圖片搜尋，找出影片原本的出處
- 文件開啟前檢查：打開收到的 Word、Excel、PowerPoint、PDF 之前，列出打開時會連到外面的位址、巨集與 JavaScript，PDF 可以轉成只有圖片的安全版本
- 下載的軟體驗證：用官方的簽章確認下載的 Tor Browser 與 Tails 沒有被改過，不必安裝 GnuPG
- 信件檢查：貼上原始郵件，看寄件驗證有沒有通過、實際的寄件網域、回覆地址有沒有被換掉，信裡的連結交給網址檢查
- 把錄音或影片的聲音轉成帶時間的逐字稿，支援華語、台語、粵語、英語、日語、韓語，以及東南亞與南亞的多種語言，可以分辨說話者，下載 TXT 與 SRT 字幕
- 用密語或 age 公鑰加密任何檔案或一段文字，以及解密
- 面對面傳送：兩台裝置連上同一個 Wi-Fi 或手機熱點，互掃 QR code 配對，用 WebRTC 直接傳暫存區的檔案，不經過任何伺服器
- 網址檢查：比對 165 反詐騙的停止解析清單、標出真正的網域、清除追蹤碼
- QR code 的產生與讀取
- 密語與密碼產生器
- 一次清除多個檔案，下載成一個壓縮檔
- 第一次開啟之後可以離線使用
- 介面有正體中文、簡體中文與英文

已經上線的小工具在[文件站的小工具區](https://anoni.net/docs/utils/)，兩邊各自開發。

## 原則

- 預設在你的瀏覽器裡處理，要傳送時先加密，伺服器只取得密文
- 影片這類比較吃重的處理，另外提供上傳到社群伺服器處理的選項。上傳前會告知檔案送到哪裡、誰看得到、保留多久，由你決定要不要上傳
- 需要連網的功能在畫面上標示，並寫明送出了什麼
- 使用統計只記工具的使用次數，送到社群自架的 Umami，不含檔案、檔名與你輸入的內容，可以在頁尾關掉。瀏覽器的 Do Not Track 與 Global Privacy Control 一律遵守
- 先支援 Brave、Safari 與 Firefox

## 開發

```bash
npm install
npm run dev   # http://localhost:5173/gears/
npm test
```

開發與測試的細節見 [AGENTS.md](./AGENTS.md)。

## 授權

程式碼以 [MIT](./LICENSE) 授權。密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware)，以 CC BY 4.0 授權。工具的圖示來自 [Material Design Icons](https://pictogrammers.com/library/mdi/)。HEIC 的解碼器來自 [libheif-js](https://github.com/catdad-experiments/libheif-js)（libheif 與 libde265，LGPL-3.0），原封不動使用。PDF 的解析與寫出用 [pdf-lib](https://github.com/Hopding/pdf-lib)（MIT），PDF 遮蔽時用 [pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0）把每一頁畫成圖片。遮蔽的自動尋找用 [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) 與 [onnxruntime-web](https://github.com/microsoft/onnxruntime)（MIT），以及 [Tesseract.js](https://github.com/naptha/tesseract.js)（Apache-2.0）。逐字稿用 [Transformers.js](https://github.com/huggingface/transformers.js)（Apache-2.0）、Whisper 模型與 [opencc-js](https://github.com/nk2028/opencc-js)（MIT）。授權全文在 [licenses/](./licenses/)。

---

<a id="en"></a>

# gears

[正體中文](#zh-tw) | **English**

anoni.net Gears handles the files you are about to hand over. It strips metadata from photos and documents, redacts personal details on screen, and encrypts files before they are sent. For files you receive, it lays out leads you can verify. Maintained by the [anoni.net community](https://anoni.net/) at <https://anoni.net/gears/>. In Tor Browser, use the onion version at <http://gears.anoninetru5tflukgfaehun7q6khowgmymcff3gtk5oyesqazhmfxtyd.onion/>.

Tools in the first version:

- Strip location, device model and capture time from photos (JPEG, PNG, HEIC, WebP, GIF, TIFF and more)
- Strip authors, company, printer and local file paths from Word, Excel, PowerPoint, LibreOffice documents and PDF
- Strip location and device model from phone videos, and tags and cover art from music and recordings (MP4, MOV, MP3, WAV, FLAC, Ogg, MKV and more)
- Strip timestamps, owners and macOS/Windows system files from archives (ZIP, TAR, tar.gz), cleaning the photos and documents inside, plus e-books, torrent files and saved web pages
- Convert iPhone HEIC photos to JPEG
- Redact names, avatars and phone numbers in screenshots and PDFs, with automatic detection of faces and personal details such as phone numbers and emails, and an option to keep capture details. A redacted PDF has every page turned into an image, so the covered text does not stay in the file
- Shrink a photo to a size commonly used for sharing and recompress it with ordinary settings, so the original resolution and the camera's compression no longer point to the phone model
- Find the faint yellow tracking dots that colour laser printers leave on a scanned or photographed page, and remove the yellow or turn the page black and white
- Hand over only some pages of a PDF. Other pages are removed, along with links to them, bookmarks and document info
- Verify files you received: hashes, a timeline, devices, authors and editing traces, with contradictions between files flagged, earlier PDF versions compared, and a verification record to export
- Video keyframes: pick out the frames that clearly differ in a video you received and save them as images for a reverse image search, to trace where the video came from
- Check a document before opening it: list the external addresses, macros and JavaScript that a Word, Excel, PowerPoint file or PDF reaches for when opened, and turn a PDF into a safe image-only copy
- Verify downloaded software: check a Tor Browser or Tails download against the official signature, without installing GnuPG
- Read an email: paste the original message to see whether it passed sender authentication, the real sending domain, and whether the reply address was swapped, with links handed to the link checker
- Turn the audio of a recording or video into a timestamped transcript in Mandarin, Taiwanese Hokkien, Cantonese, English, Japanese, Korean and many Southeast and South Asian languages, telling speakers apart, downloadable as TXT or SRT subtitles
- Encrypt any file or a piece of text with a passphrase or an age public key, and decrypt
- Nearby transfer: pair two devices on the same Wi-Fi or phone hotspot by scanning each other's QR code, and send files from the tray directly over WebRTC, without going through any server
- Check a link against Taiwan's 165 anti-fraud blocklist, show the real domain, and remove tracking parameters
- Generate and read QR codes
- Generate passphrases and passwords
- Clean many files at once and download them as one archive
- Works offline after the first visit
- Interface in Traditional Chinese, Simplified Chinese and English

The tools already online live in the [utilities section of the docs site](https://anoni.net/docs/en/utils/), which is developed separately.

## Principles

- Processing happens in your browser by default, and anything sent is encrypted first, so the server only receives ciphertext
- For heavier jobs such as video, you can choose to upload a file to a community server instead. Before anything is uploaded, Gears tells you where the file goes, who can see it and how long it is kept, and the choice is yours
- Features that need the network are labelled, along with what they send
- Usage statistics only count how tools are used and go to the community's self-hosted Umami, with no files, file names or anything you type. You can turn them off in the footer, and Do Not Track and Global Privacy Control are always honoured
- Brave, Safari and Firefox are supported first

## Development

```bash
npm install
npm run dev   # http://localhost:5173/gears/
npm test
```

See [AGENTS.md](./AGENTS.md) (in Chinese) for details on development and testing.

## License

The code is released under the [MIT License](./LICENSE). The passphrase wordlist comes from [asian-diceware](https://github.com/anoni-net/asian-diceware) under CC BY 4.0. Tool icons come from [Material Design Icons](https://pictogrammers.com/library/mdi/). The HEIC decoder is [libheif-js](https://github.com/catdad-experiments/libheif-js) (libheif and libde265, LGPL-3.0), used unmodified. PDF parsing and writing uses [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT), and PDF redaction renders each page with [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0). Automatic detection in redaction uses [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) and [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT), and [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0). Transcripts use [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0), Whisper models and [opencc-js](https://github.com/nk2028/opencc-js) (MIT). See [licenses/](./licenses/).

<a id="zh-tw"></a>

# gears

**正體中文** | [English](#en)

anoni.net Gears 隱私工作台，在瀏覽器裡處理要交出去的檔案：清除照片與文件的中繼資料、遮蔽畫面上的個資、加密之後再傳送。收到檔案時，也能整理出可以查證的線索。由[匿名網路社群 anoni.net](https://anoni.net/) 維護，網址是 <https://anoni.net/gears/>。

目前在開發中，還沒有部署。第一版的工具：

- 清除照片的拍攝位置、手機型號與拍攝時間（JPEG、PNG、HEIC、WebP、GIF、TIFF 等）
- 清除 Word、Excel、PowerPoint、LibreOffice 文件與 PDF 的作者、公司、印表機與電腦上的路徑
- 清除手機影片的拍攝位置與手機型號，以及音樂與錄音的標籤與封面（MP4、MOV、MP3、WAV、FLAC、Ogg、MKV 等）
- 清除壓縮檔裡每個檔案的時間與擁有者、macOS 與 Windows 留下的系統檔，裡面的照片與文件一起清（ZIP、TAR、tar.gz），以及電子書、種子檔與另存的網頁
- 把 iPhone 的 HEIC 照片轉成 JPEG
- 遮蔽截圖與 PDF 上的名字、頭像與電話，可以自動找人臉與電話、Email 這類個資，也可以選擇保留拍攝資訊。PDF 遮蔽後每一頁轉成圖片，框起來的文字不會留在檔案裡
- 只交出 PDF 的其中幾頁，其他頁連同連到它們的連結、書籤與文件資訊一起拿掉
- 查證收到的檔案：雜湊值、時間線、裝置、作者與編輯痕跡，比對檔案之間的矛盾，PDF 的舊版本可以比對差異，匯出查證紀錄
- 看懂這封信：貼上原始郵件，看寄件驗證有沒有通過、實際的寄件網域、回覆地址有沒有被換掉，信裡的連結交給網址檢查
- 把錄音或影片的聲音轉成帶時間的逐字稿（以華語為主），可以下載 TXT 與 SRT 字幕
- 用密語或 age 公鑰加密任何檔案或一段文字，以及解密
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

anoni.net Gears Privacy Workbench handles the files you are about to hand over. It strips metadata from photos and documents, redacts personal details on screen, and encrypts files before they are sent. For files you receive, it lays out leads you can verify. Maintained by the [anoni.net community](https://anoni.net/) at <https://anoni.net/gears/>.

Gears is under development and not deployed yet. Tools in the first version:

- Strip location, device model and capture time from photos (JPEG, PNG, HEIC, WebP, GIF, TIFF and more)
- Strip authors, company, printer and local file paths from Word, Excel, PowerPoint, LibreOffice documents and PDF
- Strip location and device model from phone videos, and tags and cover art from music and recordings (MP4, MOV, MP3, WAV, FLAC, Ogg, MKV and more)
- Strip timestamps, owners and macOS/Windows system files from archives (ZIP, TAR, tar.gz), cleaning the photos and documents inside, plus e-books, torrent files and saved web pages
- Convert iPhone HEIC photos to JPEG
- Redact names, avatars and phone numbers in screenshots and PDFs, with automatic detection of faces and personal details such as phone numbers and emails, and an option to keep capture details. A redacted PDF has every page turned into an image, so the covered text does not stay in the file
- Hand over only some pages of a PDF. Other pages are removed, along with links to them, bookmarks and document info
- Verify files you received: hashes, a timeline, devices, authors and editing traces, with contradictions between files flagged, earlier PDF versions compared, and a verification record to export
- Read an email: paste the original message to see whether it passed sender authentication, the real sending domain, and whether the reply address was swapped, with links handed to the link checker
- Turn the audio of a recording or video into a timestamped transcript (mainly Mandarin), downloadable as TXT or SRT subtitles
- Encrypt any file or a piece of text with a passphrase or an age public key, and decrypt
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

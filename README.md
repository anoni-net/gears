<a id="zh-tw"></a>

# gears

**正體中文** | [English](#en)

隱私工作台，在瀏覽器裡處理要交出去的檔案：清除照片與文件的中繼資料、遮蔽畫面上的個資、加密之後再傳送。由[匿名網路社群 anoni.net](https://anoni.net/) 維護，網址是 <https://anoni.net/gears/>。

目前在開發中，還沒有部署。第一版的工具：

- 清除照片的拍攝位置、手機型號與拍攝時間（JPEG、PNG、HEIC、WebP、GIF、TIFF 等）
- 清除 Word、Excel、PowerPoint、LibreOffice 文件與 PDF 的作者、公司、印表機與電腦上的路徑
- 把 iPhone 的 HEIC 照片轉成 JPEG
- 遮蔽截圖上的名字、頭像與電話
- 用密語或 age 公鑰加密任何檔案，以及解密
- 網址檢查：比對 165 反詐騙的停止解析清單、標出真正的網域、清除追蹤碼
- QR code 的產生與讀取
- 密語與密碼產生器已經上線的小工具在[文件站的小工具區](https://anoni.net/docs/utils/)，兩邊各自開發。

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

程式碼以 [MIT](./LICENSE) 授權。密語的字詞表來自 [asian-diceware](https://github.com/anoni-net/asian-diceware)，以 CC BY 4.0 授權。工具的圖示來自 [Material Design Icons](https://pictogrammers.com/library/mdi/)。HEIC 的解碼器來自 [libheif-js](https://github.com/catdad-experiments/libheif-js)（libheif 與 libde265，LGPL-3.0），原封不動使用。PDF 的解析與寫出用 [pdf-lib](https://github.com/Hopding/pdf-lib)（MIT）。授權全文在 [licenses/](./licenses/)。

---

<a id="en"></a>

# gears

[正體中文](#zh-tw) | **English**

anoni.net Gears is a privacy workbench for the files you are about to hand over. It strips metadata from photos and documents, redacts personal details on screen, and encrypts files before they are sent. Maintained by the [anoni.net community](https://anoni.net/) at <https://anoni.net/gears/>.

Gears is under development and not deployed yet. Tools in the first version:

- Strip location, device model and capture time from photos (JPEG, PNG, HEIC, WebP, GIF, TIFF and more)
- Strip authors, company, printer and local file paths from Word, Excel, PowerPoint, LibreOffice documents and PDF
- Convert iPhone HEIC photos to JPEG
- Redact names, avatars and phone numbers in screenshots
- Encrypt any file with a passphrase or an age public key, and decrypt
- Check a link against Taiwan's 165 anti-fraud blocklist, show the real domain, and remove tracking parameters
- Generate and read QR codes
- Generate passphrases and passwords The tools already online live in the [utilities section of the docs site](https://anoni.net/docs/en/utils/), which is developed separately.

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

The code is released under the [MIT License](./LICENSE). The passphrase wordlist comes from [asian-diceware](https://github.com/anoni-net/asian-diceware) under CC BY 4.0. Tool icons come from [Material Design Icons](https://pictogrammers.com/library/mdi/). The HEIC decoder is [libheif-js](https://github.com/catdad-experiments/libheif-js) (libheif and libde265, LGPL-3.0), used unmodified. PDF parsing and writing uses [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT). See [licenses/](./licenses/).

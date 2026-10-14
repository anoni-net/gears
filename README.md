<a id="zh-tw"></a>

# gears

**正體中文** | [English](#en)

隱私工作台，在瀏覽器裡處理要交出去的檔案：清除照片與文件的中繼資料、遮蔽畫面上的個資、加密之後再傳送。由[匿名網路社群 anoni.net](https://anoni.net/) 維護，網址是 <https://anoni.net/gears/>。

目前在開發中，還沒有部署。第一版可以清除 JPEG 與 PNG 照片裡的拍攝位置、手機型號與拍攝時間。已經上線的小工具在[文件站的小工具區](https://anoni.net/docs/utils/)，兩邊各自開發。

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

程式碼以 [MIT](./LICENSE) 授權。

---

<a id="en"></a>

# gears

[正體中文](#zh-tw) | **English**

anoni.net Gears is a privacy workbench for the files you are about to hand over. It strips metadata from photos and documents, redacts personal details on screen, and encrypts files before they are sent. Maintained by the [anoni.net community](https://anoni.net/) at <https://anoni.net/gears/>.

Gears is under development and not deployed yet. The first version strips location, device model and capture time from JPEG and PNG photos. The tools already online live in the [utilities section of the docs site](https://anoni.net/docs/en/utils/), which is developed separately.

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

The code is released under the [MIT License](./LICENSE).

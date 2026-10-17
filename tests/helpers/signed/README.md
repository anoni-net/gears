# 簽章的測試檔

下載的軟體驗證（`src/tools/software-verify/`）用官方真正的簽章測試，確認內建的公鑰驗得過。

- `tor-browser-15.0.25-sha256sums.txt` 與 `.asc`：Tor Browser 15.0.25 的 `sha256sums-signed-build.txt` 與它的簽章，取自 `dist.torproject.org/torbrowser/15.0.25/`
- `tails-amd64-7.14.img.sig`：Tails 7.14 映像檔的簽章，取自 `download.tails.net/tails/stable/tails-amd64-7.14/`。映像檔本身 1.5 GB，不放進來，只確認簽署的子金鑰在內建的公鑰裡

2026-10-17 下載時用 GnuPG 驗證過。

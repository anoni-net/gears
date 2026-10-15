"""產生瀏覽器測試用的 HEIC，由 tests/global-setup.ts 呼叫，檔案不進版控。

需要 pillow-heif（BSD-3-Clause，內含 libheif 與 x265）。本機用
`uv run --with pillow-heif==1.8.1 python scripts/make-test-heic.py <輸出目錄> <QR code 的 PNG>`。

- photo.heic：紅底、左上角一塊綠色，帶 iPhone 型號、時間與台北的座標
- qr.heic：把傳入的 QR code PNG 轉成 HEIC
"""

import sys
from pathlib import Path

import pillow_heif
from PIL import Image

pillow_heif.register_heif_opener()
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)

img = Image.new("RGB", (320, 240), (210, 40, 40))
img.paste(Image.new("RGB", (160, 120), (40, 170, 60)), (0, 0))
exif = Image.Exif()
exif[0x010F] = "Apple"
exif[0x0110] = "iPhone 15 Pro"
exif[0x0132] = "2026:10:15 10:00:00"
exif[0x8825] = {1: "N", 2: (25.0, 1.0, 58.8), 3: "E", 4: (121.0, 33.0, 55.44)}
img.save(out / "photo.heic", format="HEIF", exif=exif.tobytes(), quality=90)

Image.open(sys.argv[2]).convert("RGB").save(out / "qr.heic", format="HEIF", quality=95)
print(f"{out}/photo.heic, {out}/qr.heic")

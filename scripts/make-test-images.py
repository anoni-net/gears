"""產生瀏覽器測試用的圖片，由 tests/global-setup.ts 呼叫，檔案不進版控。

需要 pillow-heif（BSD-3-Clause，內含 libheif 與 x265）與 Pillow。本機用
`uv run --with pillow-heif==1.8.1 python scripts/make-test-images.py <輸出目錄> <QR code 的 PNG>`。

- photo.heic：紅底、左上角一塊綠色，帶 iPhone 型號、時間與台北的座標
- qr.heic：把傳入的 QR code PNG 轉成 HEIC
- photo.webp、photo.avif：同一張圖，帶 EXIF 與 XMP
- photo.gif：同一張圖，帶註解
- photo.tiff：同一張圖，帶型號、軟體與說明
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

xmp = (
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="25,1.98N"/></rdf:RDF></x:xmpmeta>'
)
img.save(out / "photo.webp", exif=exif.tobytes(), xmp=xmp, lossless=True)
img.save(out / "photo.avif", exif=exif.tobytes(), xmp=xmp, quality=95)
img.convert("P").save(out / "photo.gif", comment=b"Created by Jane Doe")
img.save(out / "photo.tiff", tiffinfo={271: "Apple", 272: "iPhone 15 Pro", 305: "PhotoApp 1.0", 270: "Jane Doe at home"})
print(f"{out}: photo.heic, qr.heic, photo.webp, photo.avif, photo.gif, photo.tiff")

import { expect, test } from "@playwright/test";
import { extractExif, insertExifJpeg, rebuildExif } from "../../src/tools/redact/keep-exif.ts";
import { exifFindings, parseExif } from "../../src/tools/strip-metadata/exif.ts";
import { buildTiff, sampleTiff, syntheticJpeg } from "../helpers/fixtures.ts";

test("重組的 EXIF 保留時間、地點與型號，拿掉縮圖，旋轉方向改成 1", () => {
  const source = sampleTiff(6);
  expect(parseExif(source)).toMatchObject({ orientation: 6, thumbnail: true, gps: true });
  const rebuilt = rebuildExif(source)!;
  const info = parseExif(rebuilt);
  expect(info).toMatchObject({ orientation: 1, thumbnail: false, gps: true, model: "SECRET-MODEL", serial: "SN-123456", dateTime: "2026:10:14 09:30:00" });
  expect(info.latitude).toBeCloseTo(25.033, 3);
  expect(exifFindings(info).map((f) => f.code)).not.toContain("thumbnail");
});

test("MakerNote、XMP 與 Interoperability 拿掉", () => {
  const tiff = buildTiff({
    ifd0: [
      { tag: 0x0110, type: 2, value: "MODEL" },
      // 測試用的組裝程式只寫得出文字，拿掉與否只看標籤
      { tag: 0x02bc, type: 2, value: "<xmp>PREVIEW</xmp>" },
    ],
    exif: [
      { tag: 0x9003, type: 2, value: "2026:10:14 09:30:00" },
      { tag: 0x927c, type: 2, value: "MAKERNOTE-PREVIEW" },
    ],
  });
  const rebuilt = rebuildExif(tiff)!;
  const text = new TextDecoder("latin1").decode(rebuilt);
  expect(text).toContain("MODEL");
  expect(text).toContain("2026:10:14");
  expect(text).not.toContain("PREVIEW");
});

test("從 JPEG 取出 EXIF，寫回另一張 JPEG", () => {
  const tiff = extractExif(syntheticJpeg(), "jpeg")!;
  expect(parseExif(tiff).model).toBe("SECRET-MODEL");
  const out = insertExifJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), rebuildExif(tiff)!);
  expect(parseExif(extractExif(out, "jpeg")!).model).toBe("SECRET-MODEL");
});

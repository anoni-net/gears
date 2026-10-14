import { expect, test } from "@playwright/test";
import { indexOf, sniff } from "../../src/core/bytes.ts";
import { ToolError } from "../../src/core/tool.ts";
import { parseExif } from "../../src/tools/strip-metadata/exif.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import {
  SCAN1,
  SCAN2,
  contains,
  exifSegment,
  sampleTiff,
  syntheticJpeg,
  syntheticPng,
} from "../helpers/fixtures.ts";

const codes = (findings: { code: string }[]) => findings.map((f) => f.code).sort();

test.describe("JPEG", () => {
  test("檢查找得到每一種中繼資料", () => {
    const findings = stripMetadata.inspect(syntheticJpeg(), "jpeg");
    expect(codes(findings)).toEqual(
      ["comment", "datetime", "device", "iptc", "location", "other", "owner", "serial", "software", "thumbnail", "trailer", "xmp"].sort(),
    );
    expect(findings.find((f) => f.code === "location")?.value).toBe("25.03300, 121.56540");
    expect(findings.find((f) => f.code === "device")?.value).toBe("TestMaker SECRET-MODEL");
    expect(findings.find((f) => f.code === "comment")?.value).toBe("SECRET-COMMENT");
  });

  test("清除之後找不到任何中繼資料，壓縮資料原封不動", () => {
    const input = syntheticJpeg();
    const { data, report } = stripMetadata.run(input, "jpeg");

    for (const secret of ["SECRET-MODEL", "Jane Doe", "SN-123456", "GPSLatitude", "SECRET-MPF", "SECRET-IPTC", "VENDOR-SECRET", "SECRET-COMMENT", "MOTION-PHOTO-SECRET"]) {
      expect(contains(data, secret), secret).toBe(false);
    }
    expect(stripMetadata.inspect(data, "jpeg")).toEqual([]);
    expect(sniff(data)).toBe("jpeg");

    // 兩段掃描資料都在，一個位元都沒動
    expect(Buffer.from(data).includes(Buffer.from(SCAN1))).toBe(true);
    expect(Buffer.from(data).includes(Buffer.from(SCAN2))).toBe(true);
    // 以 EOI 結尾，後面的附加資料拿掉了
    expect([...data.subarray(-2)]).toEqual([0xff, 0xd9]);

    expect(report.removed.map((r) => r.code).sort()).toEqual(
      ["app", "comment", "exif", "iptc", "jfif-thumbnail", "mpf", "trailer", "xmp"].sort(),
    );
    expect(report.kept.map((r) => r.code).sort()).toEqual(["adobe", "icc", "jfif", "orientation"].sort());
  });

  test("只保留旋轉方向，位置緊接在 JFIF 之後", () => {
    const { data } = stripMetadata.run(syntheticJpeg({ orientation: 6 }), "jpeg");
    // SOI(2) + 不帶縮圖的 JFIF(18) 之後就是 APP1
    expect([data[20], data[21]]).toEqual([0xff, 0xe1]);
    const exifAt = indexOf(data, "Exif\0\0");
    expect(exifAt).toBe(24);
    const info = parseExif(data.subarray(exifAt + 6, exifAt + 6 + 26));
    expect(info.orientation).toBe(6);
    expect(info.gps).toBe(false);
    expect(info.make).toBeUndefined();
  });

  test("旋轉方向是 1 的時候不寫回 EXIF", () => {
    const { data, report } = stripMetadata.run(syntheticJpeg({ orientation: 1 }), "jpeg");
    expect(indexOf(data, "Exif")).toBe(-1);
    expect(report.kept.map((r) => r.code)).not.toContain("orientation");
  });

  test("沒有附加資料時報告不列 trailer", () => {
    const { report } = stripMetadata.run(syntheticJpeg({ trailer: false }), "jpeg");
    expect(report.removed.map((r) => r.code)).not.toContain("trailer");
  });

  test("結構損壞的檔案停下來，不交出半套結果", () => {
    const broken = syntheticJpeg().subarray(0, 60);
    expect(() => stripMetadata.run(broken, "jpeg")).toThrow(ToolError);
    const noScan = new Uint8Array([0xff, 0xd8, ...exifSegment(sampleTiff()), 0xff, 0xd9]);
    expect(() => stripMetadata.run(noScan, "jpeg")).toThrow(ToolError);
  });
});

test.describe("PNG", () => {
  test("檢查找得到文字欄位、時間與 eXIf 裡的位置", () => {
    const findings = stripMetadata.inspect(syntheticPng(), "png");
    expect(codes(findings)).toEqual(
      ["datetime", "device", "location", "other", "owner", "serial", "software", "text", "thumbnail", "trailer", "xmp"].sort(),
    );
  });

  test("清除之後只剩影像需要的 chunk", () => {
    const { data, report } = stripMetadata.run(syntheticPng(), "png");
    for (const secret of ["Jane Doe", "SECRET-PNG-COMMENT", "xmpmeta", "SECRET-MODEL", "PRIVATE-SECRET", "PNG-TRAILER-SECRET"]) {
      expect(contains(data, secret), secret).toBe(false);
    }
    expect(stripMetadata.inspect(data, "png")).toEqual([]);
    expect(report.removed.map((r) => r.code).sort()).toEqual(["exif", "other", "text", "text", "time", "trailer", "xmp"].sort());
    expect(contains(data, "IHDR") && contains(data, "IDAT") && contains(data, "IEND")).toBe(true);
  });
});

test("用檔案開頭判斷格式", () => {
  expect(sniff(syntheticJpeg())).toBe("jpeg");
  expect(sniff(syntheticPng())).toBe("png");
  expect(sniff(new TextEncoder().encode("hello"))).toBe("unknown");
  expect(stripMetadata.accepts("unknown")).toBe(false);
});

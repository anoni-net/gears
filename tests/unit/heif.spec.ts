import { expect, test } from "@playwright/test";
import { sniff } from "../../src/core/bytes.ts";
import { ToolError } from "../../src/core/tool.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { HEVC_DATA, contains, syntheticHeif } from "../helpers/fixtures.ts";

const codes = (findings: { code: string }[]) => findings.map((f) => f.code).sort();

test("HEIC：認得格式，讀得到 EXIF 與 XMP 裡的資訊", async () => {
  const heif = syntheticHeif();
  expect(sniff(heif)).toBe("heic");
  const findings = (await stripMetadata.inspect(heif, "heic"));
  expect(codes(findings)).toEqual(["datetime", "device", "location", "owner", "serial", "software", "thumbnail", "xmp"].sort());
  expect(findings.find((f) => f.code === "location")?.value).toBe("25.03300, 121.56540");
});

test("HEIC：原地清除，長度不變，影像資料一個位元都沒動", async () => {
  const heif = syntheticHeif();
  const { data, report } = (await stripMetadata.run(heif, "heic"));
  expect(data.length).toBe(heif.length);
  for (const secret of ["SECRET-MODEL", "Jane Doe", "SN-123456", "GPSLatitude"]) expect(contains(data, secret), secret).toBe(false);
  expect(Buffer.from(data).includes(Buffer.from(HEVC_DATA))).toBe(true);
  expect((await stripMetadata.inspect(data, "heic"))).toEqual([]);
  expect(sniff(data)).toBe("heic");
  expect(report.removed.map((r) => r.code).sort()).toEqual(["exif", "xmp"]);
  // 只改了中繼資料：box 的結構（ftyp、meta 的長度與位置）完全一樣
  expect(Buffer.from(data.subarray(0, 40))).toEqual(Buffer.from(heif.subarray(0, 40)));
});

test("HEIC：iloc 第 0 版也讀得到", async () => {
  const heif = syntheticHeif(0);
  expect(codes((await stripMetadata.inspect(heif, "heic")))).toContain("location");
  expect((await stripMetadata.inspect((await stripMetadata.run(heif, "heic")).data, "heic"))).toEqual([]);
});

test("HEIC：結構損壞的檔案停下來", async () => {
  const broken = syntheticHeif().subarray(0, 60);
  await expect(stripMetadata.run(broken, "heic")).rejects.toThrow(ToolError);
});

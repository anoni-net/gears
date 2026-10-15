import { expect, test } from "@playwright/test";
import { type Format, sniff } from "../../src/core/bytes.ts";
import { ToolError } from "../../src/core/tool.ts";
import { stripMetadata } from "../../src/tools/strip-metadata/index.ts";
import { contains } from "../helpers/fixtures.ts";
import {
  FLAC_FRAMES,
  MEDIA_SECRETS,
  MKV_BLOCK,
  OGG_AUDIO,
  PCM,
  VIDEO_SAMPLE,
  mp3Frames,
  oggCrc,
  syntheticAvi,
  syntheticFlac,
  syntheticMkv,
  syntheticMp3,
  syntheticMp4,
  syntheticOpus,
  syntheticVorbis,
  syntheticWav,
} from "../helpers/media.ts";

const leaks = (data: Uint8Array) => MEDIA_SECRETS.filter((s) => contains(data, s));
const has = (data: Uint8Array, part: Uint8Array) => Buffer.from(data).includes(Buffer.from(part));

const cases: {
  name: string;
  file: () => Uint8Array;
  format: Format;
  expect: string[];
  keep: Uint8Array[];
  sameLength?: boolean;
}[] = [
  { name: "MP3", file: syntheticMp3, format: "mp3", expect: ["comment", "other", "owner", "text", "thumbnail"], keep: [] },
  { name: "MP4", file: syntheticMp4, format: "mp4", expect: ["datetime", "device", "location", "other", "text", "thumbnail", "xmp"], keep: [VIDEO_SAMPLE], sameLength: true },
  { name: "MOV", file: () => syntheticMp4("qt  "), format: "mov", expect: ["location"], keep: [VIDEO_SAMPLE], sameLength: true },
  { name: "M4A", file: () => syntheticMp4("M4A "), format: "m4a", expect: ["location"], keep: [VIDEO_SAMPLE], sameLength: true },
  { name: "WAV", file: syntheticWav, format: "wav", expect: ["comment", "datetime", "other", "owner", "software", "text"], keep: [PCM] },
  { name: "AVI", file: syntheticAvi, format: "avi", expect: ["datetime", "other", "owner", "software"], keep: [VIDEO_SAMPLE], sameLength: true },
  { name: "FLAC", file: syntheticFlac, format: "flac", expect: ["comment", "location", "other", "owner", "software", "text", "thumbnail"], keep: [FLAC_FRAMES] },
  { name: "Opus", file: syntheticOpus, format: "opus", expect: ["comment", "location", "owner", "software", "text", "thumbnail"], keep: OGG_AUDIO },
  { name: "Vorbis", file: syntheticVorbis, format: "ogg", expect: ["comment", "location", "owner", "software", "text"], keep: OGG_AUDIO },
  { name: "MKV", file: () => syntheticMkv(), format: "mkv", expect: ["attachments", "comment", "datetime", "location", "owner", "software", "text"], keep: [MKV_BLOCK], sameLength: true },
  { name: "WebM（長度不明）", file: () => syntheticMkv("webm", true), format: "webm", expect: ["attachments", "comment", "datetime", "location", "owner", "software", "text"], keep: [MKV_BLOCK], sameLength: true },
];

for (const c of cases) {
  test(`${c.name}：讀得到資訊，清除後沒有秘密字串，聲音與影像資料還在`, async () => {
    const input = c.file();
    expect(sniff(input)).toBe(c.format);
    const before = await stripMetadata.inspect(input, c.format);
    const codes = before.map((f) => f.code);
    for (const code of c.expect) expect(codes, code).toContain(code);

    const { data, report } = await stripMetadata.run(input, c.format);
    expect(sniff(data)).toBe(c.format);
    expect(report.removed.length).toBeGreaterThan(0);
    expect(leaks(data)).toEqual([]);
    for (const part of c.keep) expect(has(data, part)).toBe(true);
    if (c.sameLength) expect(data.length).toBe(input.length);

    const after = await stripMetadata.inspect(data, c.format);
    expect(after.filter((f) => f.code !== "attachments")).toEqual([]);
  });
}

test("MP3：只留下音訊框", async () => {
  const { data } = await stripMetadata.run(syntheticMp3(), "mp3");
  expect(data).toEqual(mp3Frames());
});

test("MP4：位置讀成座標，時間清成零，計時的中繼資料軌清成零", async () => {
  const input = syntheticMp4();
  const before = await stripMetadata.inspect(input, "mp4");
  expect(before.find((f) => f.code === "location")?.value).toBe("25.03300, 121.56540");
  expect(before.find((f) => f.code === "datetime")?.value).toMatch(/^2024-/);
  const { data, report } = await stripMetadata.run(input, "mp4");
  expect(report.removed.map((r) => r.code)).toEqual(expect.arrayContaining(["media-tags", "media-times", "media-timed", "xmp"]));
  expect(Buffer.from(data).includes(Buffer.from("free"))).toBe(true);
});

test("Ogg：每一頁的 CRC 正確，序號連續", async () => {
  for (const file of [syntheticOpus(), syntheticVorbis()]) {
    const { data } = await stripMetadata.run(file, sniff(file));
    let at = 0;
    let seq = 0;
    while (at < data.length) {
      const view = new DataView(data.buffer, data.byteOffset + at);
      expect(String.fromCharCode(...data.subarray(at, at + 4))).toBe("OggS");
      const segments = data[at + 26]!;
      const size = [...data.subarray(at + 27, at + 27 + segments)].reduce((n, s) => n + s, 0);
      const page = data.slice(at, at + 27 + segments + size);
      const crc = view.getUint32(22, true);
      new DataView(page.buffer).setUint32(22, 0, true);
      expect(oggCrc(page)).toBe(crc);
      expect(view.getUint32(18, true)).toBe(seq++);
      at += page.length;
    }
  }
});

test("MKV：Info 的 CRC-32 重算過", async () => {
  const { data } = await stripMetadata.run(syntheticMkv(), "mkv");
  const info = Buffer.from(data).indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  // ID（4）、長度（8）、CRC 元素：ID（1）、長度（8）、值（4），之後到 Info 結束
  const size = Number(new DataView(data.buffer, data.byteOffset + info + 4).getBigUint64(0) & 0x00ffffffffffffffn);
  const crc = new DataView(data.buffer, data.byteOffset + info + 12 + 9).getUint32(0, true);
  const { crc32 } = await import("../../src/core/png-encode.ts");
  expect(crc32(data.subarray(info + 12 + 13, info + 12 + size))).toBe(crc);
});

test("多個串流交錯的 Ogg 不處理", async () => {
  const opus = syntheticOpus();
  const second = opus.slice();
  new DataView(second.buffer).setUint32(14, 0x9999, true);
  const mixed = new Uint8Array([...opus, ...second]);
  await expect(stripMetadata.run(mixed, "opus")).rejects.toThrow(ToolError);
});

test("MP4 大檔案：用 Blob 分段處理的結果跟整檔處理一樣", async () => {
  const { inspectMp4, inspectMp4Blob, stripMp4, stripMp4Blob } = await import("../../src/tools/strip-metadata/mp4.ts");
  for (const file of [syntheticMp4(), syntheticMp4("qt  ")]) {
    const whole = stripMp4(file);
    const parts = await stripMp4Blob(new Blob([file as Uint8Array<ArrayBuffer>]));
    expect(new Uint8Array(await parts.blob.arrayBuffer())).toEqual(whole.data);
    expect(parts.report).toEqual(whole.report);
    expect(await inspectMp4Blob(new Blob([file as Uint8Array<ArrayBuffer>]))).toEqual(inspectMp4(file));
    expect(await inspectMp4Blob(parts.blob)).toEqual([]);
  }
});

test("其他欄位列出名稱與內容，二進位資料抽出可讀的字串", async () => {
  const { preview } = await import("../../src/tools/strip-metadata/preview.ts");
  expect(preview(new Uint8Array([0, 1, ...new TextEncoder().encode("SN-12345"), 0, 2]))).toBe("SN-12345");
  expect(preview(new Uint8Array([0xff, 0x00, 0x10]))).toBe("ff 00 10");
  const findings = await stripMetadata.inspect(syntheticMp3(), "mp3");
  expect(findings.find((f) => f.code === "other")?.value).toMatch(/^PRIV: SECRET-PRIVATE$/m);
});

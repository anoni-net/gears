import type { Finding, FindingCode } from "../../core/tool.ts";
import { other } from "./preview.ts";

// 音訊與影片的標籤各格式寫法不同（MP4 的 ©nam、ID3 的 TIT2、Vorbis 的 TITLE、RIFF 的
// INAM），名稱整理成小寫之後用同一張表判斷是哪一種資訊。

const GROUPS: [FindingCode, string[]][] = [
  ["location", ["location", "location.iso6709", "©xyz", "xyz", "gps", "location-eng"]],
  ["device", ["make", "model", "©mak", "©mod", "manufacturer", "com.android.manufacturer", "com.android.model", "device"]],
  [
    "software",
    ["encoder", "encoded_by", "encodedby", "software", "©swr", "©too", "©enc", "tool", "writing_app", "muxing_app", "isft", "com.android.version"],
  ],
  [
    "datetime",
    ["date", "creation_time", "creationdate", "©day", "year", "date_recorded", "date_released", "icrd", "date_encoded", "recording_time"],
  ],
  [
    "owner",
    [
      "artist",
      "author",
      "composer",
      "performer",
      "album_artist",
      "copyright",
      "organization",
      "publisher",
      "©art",
      "©aut",
      "©wrt",
      "©cpy",
      "aart",
      "cprt",
      "iart",
      "ieng",
      "itch",
      "icop",
      "icms",
      "director",
      "producer",
      "perf",
      "auth",
    ],
  ],
  ["comment", ["comment", "description", "©cmt", "©des", "desc", "ldes", "dscp", "icmt", "synopsis", "lyrics", "©lyr"]],
  ["text", ["title", "album", "©nam", "©alb", "inam", "iprd", "subject", "isbj", "keywords", "ikey", "displayname", "name", "titl", "albm", "kywd"]],
];

const LOOKUP = new Map<string, FindingCode>();
for (const [code, keys] of GROUPS) for (const key of keys) LOOKUP.set(key, code);

// ISO 6709：+25.0330+121.5654+010.000/，只處理十進位度數的寫法
export function iso6709(value: string): string | undefined {
  const m = /^([+-]\d{1,3}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/.exec(value.trim());
  if (!m) return undefined;
  return `${Number(m[1]).toFixed(5)}, ${Number(m[2]).toFixed(5)}`;
}

export function tagFinding(key: string, value: string | undefined): Finding {
  const name = key
    .toLowerCase()
    .replace(/^com\.apple\.quicktime\./, "")
    .trim();
  const code = LOOKUP.get(name) ?? "other";
  const text = value?.replace(/\0+$/, "").trim().slice(0, 80) || undefined;
  if (code === "location") return { code, value: (text && iso6709(text)) ?? text };
  if (code === "other") return other(key, text);
  return { code, value: text };
}

// Vorbis comment：FLAC、Ogg Vorbis 與 Opus 共用。編碼程式的名稱（vendor）、筆數，
// 每一筆是「KEY=value」，長度都是 4 個位元組的小端序
export function vorbisCommentFindings(bytes: Uint8Array, start: number, end: number): Finding[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const findings: Finding[] = [];
  let at = start;
  const read = () => {
    if (at + 4 > end) return null;
    const length = view.getUint32(at, true);
    if (at + 4 + length > end) return null;
    const text = decoder.decode(bytes.subarray(at + 4, at + 4 + length));
    at += 4 + length;
    return text;
  };
  const vendor = read();
  if (vendor) findings.push({ code: "software", value: vendor.slice(0, 80) });
  if (at + 4 > end) return findings;
  const count = view.getUint32(at, true);
  at += 4;
  for (let i = 0; i < count; i++) {
    const entry = read();
    if (entry === null) break;
    const eq = entry.indexOf("=");
    const key = eq < 0 ? entry : entry.slice(0, eq);
    if (key.toUpperCase() === "METADATA_BLOCK_PICTURE" || key.toUpperCase() === "COVERART") findings.push({ code: "thumbnail" });
    else findings.push(tagFinding(key, entry.slice(eq + 1)));
  }
  return findings;
}

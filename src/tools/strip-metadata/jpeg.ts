import { ascii, concat, indexOf, startsWith, u16be } from "../../core/bytes.ts";
import { type Finding, type Report, type ReportItem, type RunResult, ToolError } from "../../core/tool.ts";
import { exifFindings, orientationSegment, parseExif } from "./exif.ts";
import { other } from "./preview.ts";

// JPEG 的中繼資料都放在 marker 區段裡，壓縮過的影像資料在 SOS 之後。清除時只拿掉
// 區段、其餘照抄，影像資料一個位元都不動，輸出也不會留下重新編碼的痕跡。
//
// 跟文件站的版本相比多處理兩件事：
//
// - EOI 之後的附加資料。iPhone 的 HDR 增益圖、Android 動態照片的影片、部分廠商的
//   私有資料都接在影像結束標記後面，裡面可能有另一份 EXIF 或一段帶聲音的影片。
// - 旋轉方向。整段 EXIF 拿掉之後直拍的照片會變成橫的，所以只把這一個欄位寫回去。

interface Segment {
  marker: number; // -1 代表 SOS 之後的壓縮資料
  start: number;
  end: number;
}

interface Walk {
  segments: Segment[];
  trailer: number; // EOI 之後的位置，沒有 EOI 時等於檔案長度
  hasScan: boolean;
}

const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

function walk(bytes: Uint8Array): Walk {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ToolError("broken");
  const segments: Segment[] = [];
  let hasScan = false;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff || i + 1 >= bytes.length) throw new ToolError("broken");
    // 連續的 0xFF 是合法的填充
    while (bytes[i + 1] === 0xff && i + 2 < bytes.length) i++;
    const marker = bytes[i + 1]!;
    if (marker === 0xd9) {
      segments.push({ marker, start: i, end: i + 2 });
      return { segments, trailer: i + 2, hasScan };
    }
    if (STANDALONE.has(marker)) {
      segments.push({ marker, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) throw new ToolError("broken");
    const length = u16be(bytes, i + 2);
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) throw new ToolError("broken");
    segments.push({ marker, start: i, end });
    i = end;
    if (marker === 0xda) {
      // 壓縮資料裡的 0xFF 後面接 0x00（跳脫）或 RST，遇到其他 marker 才算結束。
      // 漸進式 JPEG 有好幾段 SOS，中間夾著 DHT，所以結束之後回到外層繼續讀。
      hasScan = true;
      let j = i;
      while (j + 1 < bytes.length) {
        if (bytes[j] === 0xff) {
          const next = bytes[j + 1]!;
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            j += 2;
            continue;
          }
          if (next !== 0xff) break;
        }
        j++;
      }
      if (j + 1 >= bytes.length) j = bytes.length;
      segments.push({ marker: -1, start: i, end: j });
      i = j;
    }
  }
  return { segments, trailer: bytes.length, hasScan };
}

// 區段內容（marker 與長度之後）的開頭
const body = (s: Segment) => s.start + 4;

function classify(bytes: Uint8Array, s: Segment) {
  const at = body(s);
  switch (s.marker) {
    case 0xe0:
      return startsWith(bytes, at, "JFIF\0") ? "jfif" : "app";
    case 0xe1:
      if (startsWith(bytes, at, "Exif\0")) return "exif";
      if (startsWith(bytes, at, "http://ns.adobe.com/")) return "xmp";
      return "app";
    case 0xe2:
      if (startsWith(bytes, at, "ICC_PROFILE\0")) return "icc";
      if (startsWith(bytes, at, "MPF\0")) return "mpf";
      return "app";
    case 0xed:
      return startsWith(bytes, at, "Photoshop 3.0\0") ? "iptc" : "app";
    case 0xee:
      return startsWith(bytes, at, "Adobe") ? "adobe" : "app";
    case 0xfe:
      return "comment";
    default:
      return s.marker >= 0xe0 && s.marker <= 0xef ? "app" : "image";
  }
}

// JFIF 區段可以帶一張縮圖。Xthumbnail 與 Ythumbnail 在內容的第 12、13 個位元組。
function jfifThumbnailSize(bytes: Uint8Array, s: Segment): number {
  const at = body(s);
  if (s.end - at < 14) return 0;
  return bytes[at + 12]! * bytes[at + 13]! * 3;
}

function withoutJfifThumbnail(bytes: Uint8Array, s: Segment): Uint8Array {
  const out = new Uint8Array(18);
  out.set(bytes.subarray(s.start, s.start + 18));
  out[2] = 0;
  out[3] = 16;
  out[16] = 0;
  out[17] = 0;
  return out;
}

export function stripJpeg(bytes: Uint8Array): RunResult {
  const { segments, trailer, hasScan } = walk(bytes);
  if (!hasScan) throw new ToolError("broken");
  const removed: ReportItem[] = [];
  const kept: ReportItem[] = [];
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation: number | undefined;
  let insertAt = 1; // 旋轉方向的區段放在 SOI 或 JFIF 之後

  for (const [index, s] of segments.entries()) {
    const kind = classify(bytes, s);
    const size = s.end - s.start;
    switch (kind) {
      case "jfif": {
        if (jfifThumbnailSize(bytes, s) > 0) {
          const clean = withoutJfifThumbnail(bytes, s);
          removed.push({ code: "jfif-thumbnail", bytes: size - clean.length });
          kept.push({ code: "jfif", bytes: clean.length });
          parts.push(clean);
        } else {
          kept.push({ code: "jfif", bytes: size });
          parts.push(bytes.subarray(s.start, s.end));
        }
        if (index === 0) insertAt = 2;
        break;
      }
      case "icc":
      case "adobe":
        kept.push({ code: kind, bytes: size });
        parts.push(bytes.subarray(s.start, s.end));
        break;
      case "exif": {
        const info = parseExif(bytes.subarray(body(s) + 6, s.end));
        if (orientation === undefined && info.orientation && info.orientation >= 2 && info.orientation <= 8) {
          orientation = info.orientation;
        }
        removed.push({ code: "exif", bytes: size });
        break;
      }
      case "xmp":
      case "mpf":
      case "iptc":
      case "comment":
      case "app":
        removed.push({ code: kind, bytes: size });
        break;
      default:
        parts.push(bytes.subarray(s.start, s.end));
    }
  }

  if (trailer < bytes.length) removed.push({ code: "trailer", bytes: bytes.length - trailer });

  if (orientation !== undefined) {
    const segment = orientationSegment(orientation);
    parts.splice(insertAt, 0, segment);
    kept.push({ code: "orientation", bytes: segment.length });
  }

  const report: Report = { removed, kept };
  return { data: concat(parts), report };
}

export function inspectJpeg(bytes: Uint8Array): Finding[] {
  let result: Walk;
  try {
    result = walk(bytes);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  for (const s of result.segments) {
    const kind = classify(bytes, s);
    switch (kind) {
      case "exif": {
        const info = parseExif(bytes.subarray(body(s) + 6, s.end));
        findings.push(...exifFindings(info));
        break;
      }
      case "xmp": {
        findings.push({ code: "xmp" });
        const xmp = bytes.subarray(body(s), s.end);
        if (indexOf(xmp, "GPSLatitude") >= 0) findings.push({ code: "location" });
        break;
      }
      case "iptc":
        findings.push({ code: "iptc" });
        break;
      case "comment": {
        const text = ascii(bytes, body(s), Math.min(80, s.end - body(s))).replace(/[^\x20-\x7e]/g, "").trim();
        findings.push({ code: "comment", value: text || undefined });
        break;
      }
      case "mpf":
        findings.push({ code: "trailer" });
        break;
      case "jfif":
        if (jfifThumbnailSize(bytes, s) > 0) findings.push({ code: "thumbnail" });
        break;
      case "app":
        findings.push(other(`APP${bytes[s.start + 1]! - 0xe0}`, bytes.subarray(body(s), s.end)));
        break;
    }
  }
  if (result.trailer < bytes.length) findings.push({ code: "trailer" });
  return findings;
}

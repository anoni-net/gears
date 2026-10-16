import type * as PdfLib from "pdf-lib";
import type { Format } from "../../core/bytes.ts";
import type { Finding } from "../../core/tool.ts";
import { decodeUtf8, walkXml } from "../../core/xml.ts";
import { entryData, readZip } from "../../core/zip.ts";
import { extractExif } from "../redact/keep-exif.ts";
import { parseExif } from "../strip-metadata/exif.ts";
import { type TimeValue, anyTime, exifTime, gpsTime, isoTime, pdfTime } from "./times.ts";

// 查證：讀出檔案裡可以用來驗證的資訊。跟清除中繼資料讀的是同一批欄位，清除時當成風險，
// 這裡當成線索，所以保留來源與原本的寫法，不做任何判斷。判斷（矛盾、重複）在 summary.ts。

export type TimeKind = "taken" | "digitized" | "modified" | "gps" | "created" | "printed" | "metadata" | "history" | "recorded";
export type TimeSource = "exif" | "xmp" | "pdf" | "office" | "odf" | "file";

export interface TimeEntry extends TimeValue {
  kind: TimeKind;
  source: TimeSource;
  note?: string; // 編輯紀錄的動作與軟體
}

export type PersonRole = "author" | "last-modified-by" | "owner" | "company" | "printed-by";

export type TraceCode = "xmp-history" | "pdf-revisions" | "office-revision" | "office-editing-time" | "office-template" | "thumbnail";

export interface Trace {
  code: TraceCode;
  value?: string;
  count?: number;
}

export interface Signature {
  name?: string;
  time?: TimeValue;
  coversWhole: boolean; // 簽章涵蓋到檔案結尾，簽完之後沒有再加內容
}

export interface Evidence {
  times: TimeEntry[];
  devices: string[];
  serials: string[];
  software: string[];
  people: { role: PersonRole; value: string }[];
  locations: { lat: number; lon: number }[];
  traces: Trace[];
  thumbnail?: Uint8Array; // 照片內嵌的縮圖（JPEG）
  revisions: number[]; // PDF：較早版本的結尾位置，不含最後一版
  signatures: Signature[];
  pages?: number; // PDF 的頁數
}

const empty = (): Evidence => ({ times: [], devices: [], serials: [], software: [], people: [], locations: [], traces: [], revisions: [], signatures: [] });

function addUnique<T>(list: T[], value: T | undefined, same: (a: T, b: T) => boolean = (a, b) => a === b) {
  if (value !== undefined && value !== "" && !list.some((v) => same(v, value))) list.push(value);
}

function addTime(ev: Evidence, kind: TimeKind, source: TimeSource, value: TimeValue | undefined, note?: string) {
  if (!value) return;
  if (ev.times.some((t) => t.kind === kind && t.sort === value.sort && t.text === value.text && t.offset === value.offset)) return;
  ev.times.push({ ...value, kind, source, note });
}

const addPerson = (ev: Evidence, role: PersonRole, value: string | undefined) =>
  addUnique(ev.people, value?.trim() ? { role, value: value.trim().slice(0, 120) } : undefined, (a, b) => a.role === b.role && a.value === b.value);

// --- XMP：照片、PDF、影片都可能有，用 <x:xmpmeta> 找出來 ---

const NS = {
  xmp: "http://ns.adobe.com/xap/1.0/",
  xmpMM: "http://ns.adobe.com/xap/1.0/mm/",
  stEvt: "http://ns.adobe.com/xap/1.0/sType/ResourceEvent#",
  dc: "http://purl.org/dc/elements/1.1/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  pdf: "http://ns.adobe.com/pdf/1.3/",
  exif: "http://ns.adobe.com/exif/1.0/",
};

function xmpPackets(bytes: Uint8Array): string[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const packets: string[] = [];
  let from = 0;
  while (packets.length < 8) {
    const start = text.indexOf("<x:xmpmeta", from);
    if (start < 0) break;
    const end = text.indexOf("</x:xmpmeta>", start);
    if (end < 0) break;
    packets.push(decodeUtf8(bytes.subarray(start, end + "</x:xmpmeta>".length)));
    from = end;
  }
  return packets;
}

export function readXmp(ev: Evidence, packet: string) {
  const events: Record<string, string>[] = [];
  const field = (ns: string | null, local: string, value: string) => {
    if (ns === NS.xmp && local === "CreateDate") addTime(ev, "created", "xmp", isoTime(value));
    else if (ns === NS.xmp && local === "ModifyDate") addTime(ev, "modified", "xmp", isoTime(value));
    else if (ns === NS.xmp && local === "MetadataDate") addTime(ev, "metadata", "xmp", isoTime(value));
    else if (ns === NS.photoshop && local === "DateCreated") addTime(ev, "taken", "xmp", isoTime(value));
    else if (ns === NS.exif && local === "DateTimeOriginal") addTime(ev, "taken", "xmp", isoTime(value));
    else if (ns === NS.xmp && local === "CreatorTool") addUnique(ev.software, value.slice(0, 120));
    else if (ns === NS.pdf && local === "Producer") addUnique(ev.software, value.slice(0, 120));
  };
  try {
    walkXml(packet, (el, text) => {
      const inHistory = el.parents.some((p) => p.ns === NS.xmpMM && p.local === "History");
      if (text === null) {
        if (inHistory && el.local === "li") events.push({});
        for (const a of el.attrs) {
          const event = events.at(-1);
          if (inHistory && a.ns === NS.stEvt) {
            if (event) event[a.local] = a.value;
          } else {
            field(a.ns, a.local, a.value);
          }
        }
        return;
      }
      if (inHistory && el.ns === NS.stEvt) {
        if (events.at(-1)) events.at(-1)![el.local] = text;
      } else if (el.parents.some((p) => p.ns === NS.dc && p.local === "creator") && el.local === "li") {
        addPerson(ev, "author", text);
      } else {
        field(el.ns, el.local, text);
      }
    });
  } catch {
    // 讀不完整的 XMP 就停在讀到的部分
  }
  for (const e of events) {
    const note = [e.action, e.softwareAgent].filter(Boolean).join(" · ") || undefined;
    addTime(ev, "history", "xmp", isoTime(e.when), note);
    if (e.softwareAgent) addUnique(ev.software, e.softwareAgent.slice(0, 120));
  }
  if (events.length) ev.traces.push({ code: "xmp-history", count: events.length });
}

// --- 照片：EXIF ---

const PHOTO: Format[] = ["jpeg", "png", "webp", "heic", "avif"];

function examinePhoto(ev: Evidence, bytes: Uint8Array, format: Format) {
  const tiff = extractExif(bytes, format);
  if (!tiff) return;
  const info = parseExif(tiff);
  addTime(ev, "taken", "exif", exifTime(info.dateOriginal, info.offsetOriginal));
  addTime(ev, "digitized", "exif", exifTime(info.dateDigitized, info.offsetDigitized));
  addTime(ev, "modified", "exif", exifTime(info.dateModified, info.offsetModified));
  addTime(ev, "gps", "exif", gpsTime(info.gpsDate, info.gpsTime));
  addUnique(ev.devices, [info.make, info.model].filter(Boolean).join(" ") || undefined);
  if (info.lens) addUnique(ev.devices, info.lens);
  addUnique(ev.serials, info.serial);
  addPerson(ev, "owner", info.owner);
  addUnique(ev.software, info.software);
  if (info.latitude !== undefined && info.longitude !== undefined) {
    addUnique(ev.locations, { lat: info.latitude, lon: info.longitude }, (a, b) => a.lat === b.lat && a.lon === b.lon);
  }
  if (info.thumbnailAt !== undefined && info.thumbnailLength) {
    const thumb = tiff.slice(info.thumbnailAt, info.thumbnailAt + info.thumbnailLength);
    if (thumb[0] === 0xff && thumb[1] === 0xd8) {
      ev.thumbnail = thumb;
      ev.traces.push({ code: "thumbnail" });
    }
  }
}

// --- PDF ---

type Lib = typeof PdfLib;

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

// 每一個 %%EOF 是一次存檔的結尾。修改 PDF 時常把新的內容接在後面（增量更新），
// 舊的版本留在檔案前段，切到那個 %%EOF 就是當時的檔案
function eofEnds(bytes: Uint8Array): number[] {
  const text = latin1(bytes);
  const ends: number[] = [];
  for (let at = text.indexOf("%%EOF"); at >= 0; at = text.indexOf("%%EOF", at + 5)) {
    let end = at + 5;
    if (text[end] === "\r") end++;
    if (text[end] === "\n") end++;
    ends.push(end);
  }
  return ends;
}

async function examinePdf(ev: Evidence, bytes: Uint8Array) {
  const lib: Lib = await import("../strip-metadata/pdf-lib.ts");
  let doc: PdfLib.PDFDocument;
  try {
    doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    ev.pages = doc.getPageCount();
  } catch {
    return;
  }
  // 加密的 PDF 字串也加密了，讀出來是亂碼，只看得到有幾個版本
  const encrypted = doc.isEncrypted;
  const { context } = doc;
  const str = (dict: PdfLib.PDFDict, key: string) => {
    if (encrypted) return undefined;
    const v = dict.lookup(lib.PDFName.of(key));
    return v instanceof lib.PDFString || v instanceof lib.PDFHexString ? v.decodeText() : undefined;
  };

  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof lib.PDFDict) {
    addTime(ev, "created", "pdf", pdfTime(str(info, "CreationDate")));
    addTime(ev, "modified", "pdf", pdfTime(str(info, "ModDate")));
    addPerson(ev, "author", str(info, "Author"));
    addUnique(ev.software, str(info, "Creator")?.slice(0, 120));
    addUnique(ev.software, str(info, "Producer")?.slice(0, 120));
  }

  // XMP 常常壓縮過，從文件目錄的 /Metadata 解開；沒有壓縮的也會被下面的通用搜尋找到
  const metadata = doc.catalog.lookup(lib.PDFName.of("Metadata"));
  if (metadata instanceof lib.PDFRawStream) {
    try {
      readXmp(ev, decodeUtf8(lib.decodePDFRawStream(metadata).decode()));
    } catch {
      // 解不開就略過
    }
  }

  const ends = eofEnds(bytes);
  const fileEnd = latin1(bytes).trimEnd().length;
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof lib.PDFDict)) continue;
    const range = obj.lookup(lib.PDFName.of("ByteRange"));
    if (!(range instanceof lib.PDFArray) || range.size() !== 4 || !obj.has(lib.PDFName.of("Contents"))) continue;
    const nums = range.asArray().map((n) => (n instanceof lib.PDFNumber ? n.asNumber() : 0));
    ev.signatures.push({ name: str(obj, "Name"), time: pdfTime(str(obj, "M")), coversWhole: nums[2]! + nums[3]! >= fileEnd });
  }

  // 線性化（快速網頁檢視）的 PDF 開頭有一段給第一頁用的交互參照，第一個 %%EOF 不是一個版本
  const linearized = latin1(bytes.subarray(0, 1024)).includes("/Linearized");
  const candidates = ends.slice(linearized ? 1 : 0, -1);
  for (const end of candidates) {
    try {
      const old = await lib.PDFDocument.load(bytes.subarray(0, end), { updateMetadata: false, ignoreEncryption: true });
      if (old.getPageCount() > 0) ev.revisions.push(end);
    } catch {
      // 切不出完整檔案的位置不算一個版本
    }
  }
  if (ev.revisions.length) ev.traces.push({ code: "pdf-revisions", count: ev.revisions.length + 1 });
}

// --- Office（OOXML）與 LibreOffice（ODF） ---

async function zipText(bytes: Uint8Array, name: string): Promise<string | undefined> {
  const entry = readZip(bytes).entries.find((e) => e.name === name);
  if (!entry || entry.size > 4 * 1024 * 1024) return undefined;
  return decodeUtf8(await entryData(bytes, entry));
}

const OOXML_CORE = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const OOXML_APP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const DCTERMS = "http://purl.org/dc/terms/";
const ODF_META = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";

async function examineOoxml(ev: Evidence, bytes: Uint8Array) {
  const core = await zipText(bytes, "docProps/core.xml");
  if (core) {
    walkXml(core, (el, text) => {
      if (text === null) return;
      if (el.ns === NS.dc && el.local === "creator") addPerson(ev, "author", text);
      else if (el.ns === OOXML_CORE && el.local === "lastModifiedBy") addPerson(ev, "last-modified-by", text);
      else if (el.ns === DCTERMS && el.local === "created") addTime(ev, "created", "office", isoTime(text));
      else if (el.ns === DCTERMS && el.local === "modified") addTime(ev, "modified", "office", isoTime(text));
      else if (el.ns === OOXML_CORE && el.local === "lastPrinted") addTime(ev, "printed", "office", isoTime(text));
      else if (el.ns === OOXML_CORE && el.local === "revision" && Number(text)) ev.traces.push({ code: "office-revision", count: Number(text) });
    });
  }
  const app = await zipText(bytes, "docProps/app.xml");
  if (app) {
    let application: string | undefined;
    let version: string | undefined;
    walkXml(app, (el, text) => {
      if (text === null || el.ns !== OOXML_APP) return;
      if (el.local === "Application") application = text;
      else if (el.local === "AppVersion") version = text;
      else if (el.local === "Company") addPerson(ev, "company", text);
      else if (el.local === "TotalTime" && Number(text)) ev.traces.push({ code: "office-editing-time", count: Number(text) });
      else if (el.local === "Template" && text !== "Normal.dotm" && text !== "Normal") ev.traces.push({ code: "office-template", value: text.slice(0, 120) });
    });
    addUnique(ev.software, application && [application, version].filter(Boolean).join(" "));
  }
}

// ODF 的編輯時間是 ISO 8601 的期間：PT1H2M3S、P1DT2H
function durationMinutes(text: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/.exec(text.trim());
  if (!m) return 0;
  return (+(m[1] ?? 0) * 24 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0);
}

async function examineOdf(ev: Evidence, bytes: Uint8Array) {
  const meta = await zipText(bytes, "meta.xml");
  if (!meta) return;
  walkXml(meta, (el, text) => {
    if (text === null) return;
    if (el.ns === ODF_META && el.local === "initial-creator") addPerson(ev, "author", text);
    else if (el.ns === NS.dc && el.local === "creator") addPerson(ev, "last-modified-by", text);
    else if (el.ns === ODF_META && el.local === "printed-by") addPerson(ev, "printed-by", text);
    else if (el.ns === ODF_META && el.local === "creation-date") addTime(ev, "created", "odf", isoTime(text));
    else if (el.ns === NS.dc && el.local === "date") addTime(ev, "modified", "odf", isoTime(text));
    else if (el.ns === ODF_META && el.local === "print-date") addTime(ev, "printed", "odf", isoTime(text));
    else if (el.ns === ODF_META && el.local === "generator") addUnique(ev.software, text.slice(0, 120));
    else if (el.ns === ODF_META && el.local === "editing-cycles" && Number(text)) ev.traces.push({ code: "office-revision", count: Number(text) });
    else if (el.ns === ODF_META && el.local === "editing-duration" && durationMinutes(text)) {
      ev.traces.push({ code: "office-editing-time", count: durationMinutes(text) });
    }
  });
}

// --- 其他格式：清除中繼資料的檢查結果 ---

const UTC_FORMATS: Format[] = ["mp4", "mov", "m4a"]; // mvhd 的時間是 UTC

function fromFindings(ev: Evidence, findings: Finding[], format: Format) {
  for (const f of findings) {
    for (const value of f.value?.split("\n") ?? []) {
      if (value.startsWith("… +")) continue;
      if (f.code === "datetime") {
        const t = anyTime(value);
        addTime(ev, "recorded", "file", t && !t.offset && UTC_FORMATS.includes(format) ? { ...t, offset: "+00:00" } : t);
      } else if (f.code === "device") addUnique(ev.devices, value);
      else if (f.code === "serial") addUnique(ev.serials, value);
      else if (f.code === "software") addUnique(ev.software, value);
      else if (f.code === "owner") for (const name of value.split("、")) addPerson(ev, "author", name);
      else if (f.code === "location") {
        const m = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(value.trim());
        if (m) addUnique(ev.locations, { lat: +m[1]!, lon: +m[2]! }, (a, b) => a.lat === b.lat && a.lon === b.lon);
      }
    }
  }
}

const OOXML: Format[] = ["docx", "xlsx", "pptx"];
const ODF: Format[] = ["odt", "ods", "odp", "odg"];

// findings 是暫存區加入檔案時清除中繼資料檢查的結果，沒有專門讀取的格式用它補上
export async function examine(bytes: Uint8Array, format: Format, findings: Finding[] = []): Promise<Evidence> {
  const ev = empty();
  try {
    if (PHOTO.includes(format)) examinePhoto(ev, bytes, format);
    else if (format === "pdf") await examinePdf(ev, bytes);
    else if (OOXML.includes(format)) await examineOoxml(ev, bytes);
    else if (ODF.includes(format)) await examineOdf(ev, bytes);
  } catch {
    // 結構有問題的檔案，讀到哪裡算哪裡
  }
  if (format !== "pdf") for (const packet of xmpPackets(bytes)) readXmp(ev, packet);
  if (!PHOTO.includes(format) && format !== "pdf" && !OOXML.includes(format) && !ODF.includes(format)) fromFindings(ev, findings, format);
  ev.times.sort((a, b) => a.sort - b.sort);
  return ev;
}

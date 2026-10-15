import { crc32 } from "../../core/png-encode.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { tagFinding } from "./media-tags.ts";
import { Tally } from "./package.ts";

// MKV 與 WebM（EBML）：元素是「ID、長度、內容」，長度用可變長度的整數。
//
// - Tags：標題、演出者、日期、地點、編碼程式，從手機影片轉檔時常把位置一起帶過來
// - Info：標題、建立時間（DateUTC）、原本的檔名、封裝與編碼程式的名稱
// - Tracks：每個軌道的名稱
//
// Cues 記錄每個 Cluster 的位置，所以這裡原地處理：整個拿掉的元素換成同樣長度的 Void，
// 規定一定要有的 MuxingApp、WritingApp 把文字清成零（空字串）。母元素帶著 CRC-32 的話重算。
// 附加檔案（Attachments，多半是字型與封面）是內容，保留下來，檢查時另外提醒。

const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  Info: 0x1549a966,
  Title: 0x7ba9,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  DateUTC: 0x4461,
  SegmentFilename: 0x7384,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Name: 0x536e,
  Cues: 0x1c53bb6b,
  Cluster: 0x1f43b675,
  Attachments: 0x1941a469,
  AttachedFile: 0x61a7,
  FileName: 0x466e,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Tag: 0x7373,
  SimpleTag: 0x67c8,
  TagName: 0x45a3,
  TagString: 0x4487,
  Void: 0xec,
  CRC: 0xbf,
};

const LEVEL1 = new Set([ID.SeekHead, ID.Info, ID.Tracks, ID.Cues, ID.Cluster, ID.Attachments, ID.Chapters, ID.Tags]);

interface Element {
  id: number;
  start: number;
  data: number;
  end: number;
}

function vint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } {
  const first = bytes[at];
  if (first === undefined || first === 0) throw new ToolError("broken");
  const length = Math.clz32(first) - 23;
  if (at + length > bytes.length) throw new ToolError("broken");
  let value = keepMarker ? first : first & (0xff >> length);
  let ones = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i]!;
    ones &&= bytes[at + i] === 0xff;
  }
  return { value, length, unknown: !keepMarker && ones };
}

function children(bytes: Uint8Array, start: number, end: number): Element[] {
  const list: Element[] = [];
  let at = start;
  while (at < end) {
    const id = vint(bytes, at, true);
    const size = vint(bytes, at + id.length, false);
    const data = at + id.length + size.length;
    let stop: number;
    if (size.unknown) {
      if (id.value !== ID.Segment && id.value !== ID.Cluster) throw new ToolError("unsupported");
      stop = id.value === ID.Segment ? end : clusterEnd(bytes, data, end);
    } else stop = data + size.value;
    if (stop > end) throw new ToolError("broken");
    list.push({ id: id.value, start: at, data, end: stop });
    at = stop;
  }
  return list;
}

// 長度不明的 Cluster（直播或錄影中斷的檔案）一直到下一個第一層元素為止
function clusterEnd(bytes: Uint8Array, start: number, end: number): number {
  let at = start;
  while (at < end) {
    const id = vint(bytes, at, true);
    if (LEVEL1.has(id.value)) return at;
    const size = vint(bytes, at + id.length, false);
    if (size.unknown) throw new ToolError("unsupported");
    at += id.length + size.length + size.value;
  }
  return end;
}

const find = (list: Element[], id: number) => list.find((e) => e.id === id);
const textOf = (bytes: Uint8Array, e: Element) => new TextDecoder().decode(bytes.subarray(e.data, e.end)).replace(/\0+$/, "");

function topLevel(bytes: Uint8Array): { docType: string; segment: Element } {
  const top = children(bytes, 0, bytes.length);
  const header = find(top, ID.EBML);
  const segment = find(top, ID.Segment);
  if (!header || !segment) throw new ToolError("broken");
  const docType = find(children(bytes, header.data, header.end), ID.DocType);
  return { docType: docType ? textOf(bytes, docType) : "", segment };
}

// 換成同樣長度的 Void：ID 一個位元組，長度挑放得下的最短寫法，內容清成零
function toVoid(bytes: Uint8Array, e: Element) {
  const total = e.end - e.start;
  for (let n = 1; n <= 8; n++) {
    const size = total - 1 - n;
    if (size < 0 || size >= 2 ** (7 * n) - 1) continue;
    bytes.fill(0, e.start, e.end);
    bytes[e.start] = ID.Void;
    let value = size;
    for (let i = n; i >= 1; i--) {
      bytes[e.start + i] = value % 256;
      value = Math.floor(value / 256);
    }
    bytes[e.start + 1] |= 1 << (8 - n);
    return;
  }
  throw new ToolError("broken");
}

// 母元素的第一個子元素是 CRC-32 的話，用其他子元素的內容重算
function updateCrc(bytes: Uint8Array, parent: Element) {
  const crc = children(bytes, parent.data, parent.end)[0];
  if (crc?.id !== ID.CRC || crc.end - crc.data !== 4) return;
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(crc.data, crc32(bytes.subarray(crc.end, parent.end)), true);
}

const TAGS_ID = [0x12, 0x54, 0xc3, 0x67];

export function stripEbml(input: Uint8Array): RunResult {
  const bytes = new Uint8Array(input);
  const { segment } = topLevel(bytes);
  const tally = new Tally();
  for (const e of children(bytes, segment.data, segment.end)) {
    if (e.id === ID.Tags) {
      toVoid(bytes, e);
      tally.add("media-tags");
    } else if (e.id === ID.Info) {
      for (const c of children(bytes, e.data, e.end)) {
        if (c.id === ID.Title || c.id === ID.DateUTC || c.id === ID.SegmentFilename) {
          toVoid(bytes, c);
          tally.add(c.id === ID.DateUTC ? "media-times" : "media-tags");
        } else if (c.id === ID.MuxingApp || c.id === ID.WritingApp) {
          if (bytes.subarray(c.data, c.end).some((b) => b)) tally.add("media-app");
          bytes.fill(0, c.data, c.end);
        }
      }
      updateCrc(bytes, e);
    } else if (e.id === ID.Tracks) {
      for (const track of children(bytes, e.data, e.end)) {
        if (track.id !== ID.TrackEntry) continue;
        const name = find(children(bytes, track.data, track.end), ID.Name);
        if (!name) continue;
        toVoid(bytes, name);
        tally.add("media-tags");
        updateCrc(bytes, track);
      }
      updateCrc(bytes, e);
    } else if (e.id === ID.SeekHead) {
      // 指向 Tags 的索引一併拿掉，播放器才不會去讀已經換成 Void 的位置
      for (const seek of children(bytes, e.data, e.end)) {
        if (seek.id !== ID.Seek) continue;
        const target = find(children(bytes, seek.data, seek.end), ID.SeekID);
        if (target && TAGS_ID.every((b, i) => bytes[target.data + i] === b) && target.end - target.data === 4) toVoid(bytes, seek);
      }
      updateCrc(bytes, e);
    }
  }
  return { data: bytes, report: { removed: tally.items(), kept: [{ code: "media-stream" }] } };
}

// DateUTC：從 2001-01-01 起算的奈秒，有號整數
function dateUtc(bytes: Uint8Array, e: Element): string | undefined {
  if (e.end - e.data !== 8) return undefined;
  const ns = new DataView(bytes.buffer, bytes.byteOffset).getBigInt64(e.data);
  const date = new Date(Date.UTC(2001, 0, 1) + Number(ns / 1000000n));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace("T", " ").slice(0, 19);
}

function simpleTags(bytes: Uint8Array, e: Element, findings: Finding[], depth = 0) {
  if (depth > 4) return;
  const parts = children(bytes, e.data, e.end);
  const name = find(parts, ID.TagName);
  const value = find(parts, ID.TagString);
  if (name) findings.push(tagFinding(textOf(bytes, name), value ? textOf(bytes, value) : undefined));
  for (const nested of parts) if (nested.id === ID.SimpleTag) simpleTags(bytes, nested, findings, depth + 1);
}

export function inspectEbml(bytes: Uint8Array): Finding[] {
  const findings: Finding[] = [];
  const attachments: string[] = [];
  try {
    const { segment } = topLevel(bytes);
    for (const e of children(bytes, segment.data, segment.end)) {
      if (e.id === ID.Info) {
        for (const c of children(bytes, e.data, e.end)) {
          const value = textOf(bytes, c);
          if ((c.id === ID.Title || c.id === ID.SegmentFilename) && value) findings.push({ code: "text", value: value.slice(0, 80) });
          else if ((c.id === ID.MuxingApp || c.id === ID.WritingApp) && value) findings.push({ code: "software", value: value.slice(0, 80) });
          else if (c.id === ID.DateUTC) {
            const date = dateUtc(bytes, c);
            if (date) findings.push({ code: "datetime", value: date });
          }
        }
      } else if (e.id === ID.Tags) {
        for (const tag of children(bytes, e.data, e.end)) {
          if (tag.id !== ID.Tag) continue;
          for (const simple of children(bytes, tag.data, tag.end)) if (simple.id === ID.SimpleTag) simpleTags(bytes, simple, findings);
        }
      } else if (e.id === ID.Tracks) {
        for (const track of children(bytes, e.data, e.end)) {
          const name = track.id === ID.TrackEntry ? find(children(bytes, track.data, track.end), ID.Name) : undefined;
          if (name && textOf(bytes, name)) findings.push({ code: "text", value: textOf(bytes, name).slice(0, 80) });
        }
      } else if (e.id === ID.Attachments) {
        for (const file of children(bytes, e.data, e.end)) {
          const name = file.id === ID.AttachedFile ? find(children(bytes, file.data, file.end), ID.FileName) : undefined;
          attachments.push(name ? textOf(bytes, name) : "");
        }
      }
    }
  } catch {
    return findings;
  }
  if (attachments.length) findings.push({ code: "attachments", value: attachments.filter(Boolean).slice(0, 5).join("、") || undefined });
  return findings;
}

import { ascii, u16be, u32be } from "../../core/bytes.ts";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { type Box, readBoxes } from "./heif.ts";
import { tagFinding } from "./media-tags.ts";
import { Tally } from "./package.ts";
import { other } from "./preview.ts";

// MP4、MOV、M4A（ISO 基本媒體檔案格式，跟 HEIC 同一個家族）。手機錄的影片在這裡記錄
// 拍攝位置、手機型號與系統版本。
//
// - moov/udta：QuickTime 的 ©xyz（位置）、©mak、©mod、©swr，iTunes 的標籤與封面
// - moov/meta：iPhone 用 com.apple.quicktime.location.ISO6709 這類鍵值記錄位置、型號與時間
// - mvhd、tkhd、mdhd：建立與修改時間
// - uuid：XMP 與相機廠商的私有資料
// - 計時的中繼資料軌：iPhone 的 mebx、GoPro 的 gpmd、Google 的 camm，逐格記錄位置或感測器
// - free、skip：編輯軟體留下的空間，裡面可能還有舊的中繼資料
//
// 影音資料的位置記在 stco 裡，改變 moov 的長度就要改寫所有位移。所以這裡跟 HEIC 一樣
// 原地處理：要拿掉的 box 改成 free、內容清成零，時間清成零，計時的中繼資料軌把每一格
// 的資料清成零。檔案長度與結構不變，影音資料一個位元都不動。
//
// 手機影片常有好幾 GB，超過瀏覽器能一次讀進記憶體的大小。中繼資料都在 mdat 以外的 box，
// 所以大檔案改走 Blob：只讀 mdat 以外的 box 與計時中繼資料的那幾格，改好的部分跟原檔的
// 其他片段組成新的 Blob，影音資料不經過記憶體（stripMp4Blob、inspectMp4Blob）。

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex"]);
const XMP_UUID = "be7acfcb97a942e89c71999491e3afac";
const SPHERICAL_UUID = "ffcc8263f8554a938814587a02521fdd"; // 360 度影片的標記，播放需要
const C2PA_UUID_HEX = "d8fec3d61b0e483c92975828877ec481"; // C2PA 內容憑證，跟其他 uuid 一樣拿掉，報告裡分開列
const TIMED_HANDLERS = new Set(["meta", "camm"]);
const TIME_BOXES = new Set(["mvhd", "tkhd", "mdhd"]);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

const payload = (box: Box) => box.start + box.header;

function uuidOf(bytes: Uint8Array, box: Box): string {
  return [...bytes.subarray(payload(box), payload(box) + 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function child(bytes: Uint8Array, box: Box, type: string, skip = 0): Box | undefined {
  return readBoxes(bytes, payload(box) + skip, box.end).find((b) => b.type === type);
}

function freeBox(bytes: Uint8Array, box: Box) {
  bytes.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
  bytes.fill(0, payload(box), box.end);
}

const hasContent = (bytes: Uint8Array, box: Box) => bytes.subarray(payload(box), box.end).some((b) => b !== 0);

// mvhd、tkhd、mdhd 開頭的建立與修改時間：版本 0 各 4 個位元組，版本 1 各 8 個
function timeRange(bytes: Uint8Array, box: Box): [number, number] {
  const at = payload(box);
  return [at + 4, at + (bytes[at] === 1 ? 20 : 12)];
}

function creationTime(bytes: Uint8Array, box: Box): string | undefined {
  const at = payload(box);
  const seconds = bytes[at] === 1 ? u32be(bytes, at + 4) * 2 ** 32 + u32be(bytes, at + 8) : u32be(bytes, at + 4);
  if (!seconds) return undefined;
  const date = new Date(EPOCH_1904 + seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace("T", " ").slice(0, 19);
}

interface Track {
  handler: string;
  codec: string;
  stbl?: Box;
}

function trackInfo(bytes: Uint8Array, trak: Box): Track {
  const mdia = child(bytes, trak, "mdia");
  const hdlr = mdia && child(bytes, mdia, "hdlr");
  const minf = mdia && child(bytes, mdia, "minf");
  const stbl = minf && child(bytes, minf, "stbl");
  const stsd = stbl && child(bytes, stbl, "stsd");
  return {
    handler: hdlr ? ascii(bytes, payload(hdlr) + 8, 4) : "",
    codec: stsd && stsd.end >= payload(stsd) + 16 ? ascii(bytes, payload(stsd) + 12, 4) : "",
    stbl,
  };
}

// 每一格資料在檔案裡的位置：stsc 說每個 chunk 有幾格，stco 是 chunk 的位置，stsz 是每格的長度
export function sampleRanges(bytes: Uint8Array, stbl: Box): [number, number][] {
  const boxes = readBoxes(bytes, payload(stbl), stbl.end);
  const find = (type: string) => boxes.find((b) => b.type === type);
  const stsc = find("stsc");
  const stco = find("stco") ?? find("co64");
  const stsz = find("stsz") ?? find("stz2");
  if (!stsc || !stco || !stsz) return [];

  const sizes: number[] = [];
  const sz = payload(stsz);
  if (stsz.type === "stsz") {
    const fixed = u32be(bytes, sz + 4);
    const count = u32be(bytes, sz + 8);
    for (let i = 0; i < count; i++) sizes.push(fixed || u32be(bytes, sz + 12 + i * 4));
  } else {
    const field = bytes[sz + 7]!;
    const count = u32be(bytes, sz + 8);
    for (let i = 0; i < count; i++) {
      if (field === 16) sizes.push(u16be(bytes, sz + 12 + i * 2));
      else if (field === 8) sizes.push(bytes[sz + 12 + i]!);
      else sizes.push((bytes[sz + 12 + (i >> 1)]! >> (i & 1 ? 0 : 4)) & 0x0f);
    }
  }

  const co = payload(stco);
  const chunks: number[] = [];
  const chunkCount = u32be(bytes, co + 4);
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(stco.type === "co64" ? u32be(bytes, co + 8 + i * 8) * 2 ** 32 + u32be(bytes, co + 12 + i * 8) : u32be(bytes, co + 8 + i * 4));
  }

  const sc = payload(stsc);
  const runs: [number, number][] = [];
  const runCount = u32be(bytes, sc + 4);
  for (let i = 0; i < runCount; i++) runs.push([u32be(bytes, sc + 8 + i * 12), u32be(bytes, sc + 12 + i * 12)]);

  const ranges: [number, number][] = [];
  let sample = 0;
  for (let c = 0; c < chunks.length && sample < sizes.length; c++) {
    let run: [number, number] | undefined;
    for (const r of runs) if (r[0] <= c + 1) run = r;
    let offset = chunks[c]!;
    for (let k = 0; k < (run?.[1] ?? 0) && sample < sizes.length; k++) {
      ranges.push([offset, sizes[sample]!]);
      offset += sizes[sample++]!;
    }
  }
  return ranges;
}

// 計時中繼資料每一格的位置是整個檔案裡的位置，交給 zero 處理
type Zero = (offset: number, size: number) => void;

function walkStrip(bytes: Uint8Array, start: number, end: number, tally: Tally, zero: Zero) {
  for (const box of readBoxes(bytes, start, end)) {
    const { type } = box;
    if (type === "udta" || type === "meta" || type === "XMP_") {
      freeBox(bytes, box);
      tally.add(type === "XMP_" ? "xmp" : "media-tags");
    } else if (type === "uuid") {
      const uuid = uuidOf(bytes, box);
      if (uuid === SPHERICAL_UUID) continue;
      freeBox(bytes, box);
      tally.add(uuid === XMP_UUID ? "xmp" : uuid === C2PA_UUID_HEX ? "c2pa" : "other");
    } else if (type === "free" || type === "skip") {
      if (!hasContent(bytes, box)) continue;
      bytes.fill(0, payload(box), box.end);
      tally.add("other");
    } else if (TIME_BOXES.has(type)) {
      const [from, to] = timeRange(bytes, box);
      if (bytes.subarray(from, to).some((b) => b !== 0)) tally.add("media-times");
      bytes.fill(0, from, to);
    } else if (type === "trak") {
      const track = trackInfo(bytes, box);
      if (TIMED_HANDLERS.has(track.handler) && track.stbl) {
        const ranges = sampleRanges(bytes, track.stbl);
        for (const [offset, size] of ranges) zero(offset, size);
        if (ranges.length) tally.add("media-timed");
      }
      walkStrip(bytes, payload(box), box.end, tally, zero);
    } else if (CONTAINERS.has(type)) {
      walkStrip(bytes, payload(box), box.end, tally, zero);
    }
  }
}

export function stripMp4(input: Uint8Array): RunResult {
  const bytes = new Uint8Array(input);
  const top = readBoxes(bytes, 0, bytes.length);
  if (!top.some((b) => b.type === "moov")) throw new ToolError("broken");
  const tally = new Tally();
  walkStrip(bytes, 0, bytes.length, tally, (offset, size) => {
    if (offset + size > bytes.length) throw new ToolError("broken");
    bytes.fill(0, offset, offset + size);
  });
  return { data: bytes, report: { removed: tally.items(), kept: [{ code: "media-stream" }] } };
}

const decodeText = (data: Uint8Array) => new TextDecoder().decode(data).replace(/\0+$/, "");

// iTunes 的 ilst 與 QuickTime 的 mdta：每一項裡有一個 data box，前 8 個位元組是型別與語系
function ilstFindings(bytes: Uint8Array, ilst: Box, keys: string[] | null): Finding[] {
  const findings: Finding[] = [];
  for (const item of readBoxes(bytes, payload(ilst), ilst.end)) {
    const key = keys ? keys[u32be(bytes, item.start + 4) - 1] : item.type;
    if (!key) continue;
    if (key === "covr") {
      findings.push({ code: "thumbnail" });
      continue;
    }
    const data = readBoxes(bytes, payload(item), item.end).find((b) => b.type === "data");
    const name = key === "----" ? readBoxes(bytes, payload(item), item.end).find((b) => b.type === "name") : undefined;
    const kind = data ? u32be(bytes, payload(data)) : 0;
    const value = data && (kind === 1 || kind === 0) ? decodeText(bytes.subarray(payload(data) + 8, data.end)) : undefined;
    const label = name ? decodeText(bytes.subarray(payload(name) + 4, name.end)) : key;
    findings.push(tagFinding(label, value));
  }
  return findings;
}

// QuickTime 的 meta 沒有版本與旗標，iTunes 的有，看 hdlr 出現在哪裡判斷
function metaFindings(bytes: Uint8Array, meta: Box): Finding[] {
  const skip = ascii(bytes, payload(meta) + 4, 4) === "hdlr" ? 0 : 4;
  const boxes = readBoxes(bytes, payload(meta) + skip, meta.end);
  const keysBox = boxes.find((b) => b.type === "keys");
  let keys: string[] | null = null;
  if (keysBox) {
    keys = [];
    const count = u32be(bytes, payload(keysBox) + 4);
    let at = payload(keysBox) + 8;
    for (let i = 0; i < count && at + 8 <= keysBox.end; i++) {
      const size = u32be(bytes, at);
      if (size < 8) break;
      keys.push(decodeText(bytes.subarray(at + 8, at + size)));
      at += size;
    }
  }
  const ilst = boxes.find((b) => b.type === "ilst");
  return ilst ? ilstFindings(bytes, ilst, keys) : [];
}

// 3GPP 的描述欄位：版本與旗標（4）、語系（2）、以 0 結尾的文字
const ASSET_BOXES = new Set(["titl", "dscp", "cprt", "perf", "auth", "albm", "kywd"]);

// 3GPP 的 loci：版本與旗標、語系、地名、角色（1），接著經度、緯度、高度，都是 16.16 定點數
function lociFinding(bytes: Uint8Array, box: Box): Finding {
  const at = payload(box) + 6;
  const nameEnd = bytes.indexOf(0, at);
  if (nameEnd < 0 || nameEnd + 10 > box.end) return { code: "location" };
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const lon = view.getInt32(nameEnd + 2) / 65536;
  const lat = view.getInt32(nameEnd + 6) / 65536;
  return { code: "location", value: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
}

function udtaFindings(bytes: Uint8Array, udta: Box): Finding[] {
  const findings: Finding[] = [];
  for (const box of readBoxes(bytes, payload(udta), udta.end)) {
    if (box.type === "meta") findings.push(...metaFindings(bytes, box));
    else if (box.type === "XMP_") findings.push({ code: "xmp" });
    else if (box.type === "loci") findings.push(lociFinding(bytes, box));
    else if (box.type === "yrrc") findings.push({ code: "datetime", value: String(u16be(bytes, payload(box) + 4)) });
    else if (ASSET_BOXES.has(box.type)) findings.push(tagFinding(box.type, decodeText(bytes.subarray(payload(box) + 6, box.end))));
    else if (box.type.startsWith("©")) {
      // QuickTime 的文字：長度（2）、語系（2）、內容
      const length = u16be(bytes, payload(box));
      findings.push(tagFinding(box.type, decodeText(bytes.subarray(payload(box) + 4, payload(box) + 4 + length))));
    } else findings.push(other(box.type, bytes.subarray(payload(box), box.end)));
  }
  return findings;
}

// 計時的中繼資料軌：每一格的位置，之後再讀出來看是否已經清成零
interface Timed {
  name: string;
  ranges: [number, number][];
}

function walkInspect(bytes: Uint8Array, start: number, end: number, findings: Finding[], timed: Timed[]) {
  for (const box of readBoxes(bytes, start, end)) {
    const { type } = box;
    if (type === "udta") findings.push(...udtaFindings(bytes, box));
    else if (type === "meta") findings.push(...metaFindings(bytes, box));
    else if (type === "XMP_") findings.push({ code: "xmp" });
    else if (type === "uuid") {
      const uuid = uuidOf(bytes, box);
      if (uuid === XMP_UUID) findings.push({ code: "xmp" });
      else if (uuid === C2PA_UUID_HEX) findings.push({ code: "c2pa" });
      else if (uuid !== SPHERICAL_UUID) findings.push(other(`uuid ${uuid.slice(0, 8)}`, bytes.subarray(payload(box) + 16, box.end)));
    } else if ((type === "free" || type === "skip") && box.end - payload(box) > 16 && hasContent(bytes, box)) {
      findings.push(other(type, bytes.subarray(payload(box), box.end)));
    } else if (type === "mvhd") {
      const time = creationTime(bytes, box);
      if (time) findings.push({ code: "datetime", value: time });
    } else if (type === "trak") {
      const track = trackInfo(bytes, box);
      if (TIMED_HANDLERS.has(track.handler) && track.stbl) {
        timed.push({ name: track.codec.trim() || track.handler, ranges: sampleRanges(bytes, track.stbl) });
      }
      walkInspect(bytes, payload(box), box.end, findings, timed);
    } else if (CONTAINERS.has(type)) walkInspect(bytes, payload(box), box.end, findings, timed);
  }
}

export function inspectMp4(bytes: Uint8Array): Finding[] {
  const findings: Finding[] = [];
  const timed: Timed[] = [];
  try {
    walkInspect(bytes, 0, bytes.length, findings, timed);
  } catch {
    return findings;
  }
  for (const track of timed) {
    const sample = track.ranges.map(([o, s]) => bytes.subarray(o, o + s)).find((d) => d.some((b) => b));
    if (sample) findings.push(other(track.name, sample));
  }
  return findings;
}

// --- 大檔案：用 Blob 分段讀 ---

// mdat 以外的 box 超過這個大小就不處理，正常的 moov 只有幾 MB
const MAX_BOX = 256 * 1024 * 1024;
// 檢查計時中繼資料時最多讀這麼多，夠判斷是否清過
const MAX_TIMED_READ = 4 * 1024 * 1024;

const read = async (blob: Blob, start: number, end: number) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

// 第一層的 box：只讀每個 box 的標頭
export async function topBoxes(blob: Blob): Promise<Box[]> {
  const boxes: Box[] = [];
  let at = 0;
  while (at + 8 <= blob.size) {
    const head = await read(blob, at, at + 16);
    let size = u32be(head, 0);
    let header = 8;
    if (size === 1) {
      if (head.length < 16) throw new ToolError("broken");
      size = u32be(head, 8) * 2 ** 32 + u32be(head, 12);
      header = 16;
    } else if (size === 0) size = blob.size - at;
    if (size < header || at + size > blob.size) throw new ToolError("broken");
    boxes.push({ type: ascii(head, 4, 4), start: at, header, end: at + size });
    at += size;
  }
  return boxes;
}

// mdat 以外的第一層 box 讀進記憶體，各自當成一段處理
async function readParts(blob: Blob): Promise<{ box: Box; bytes: Uint8Array }[]> {
  const boxes = await topBoxes(blob);
  if (!boxes.some((b) => b.type === "moov")) throw new ToolError("broken");
  const parts: { box: Box; bytes: Uint8Array }[] = [];
  for (const box of boxes) {
    if (box.type === "mdat") continue;
    if (box.end - box.start > MAX_BOX) throw new ToolError("unsupported");
    parts.push({ box, bytes: await read(blob, box.start, box.end) });
  }
  return parts;
}

export async function stripMp4Blob(blob: Blob): Promise<{ blob: Blob; report: RunResult["report"] }> {
  const tally = new Tally();
  const patches: { at: number; data: Uint8Array }[] = [];
  for (const { box, bytes } of await readParts(blob)) {
    walkStrip(bytes, 0, bytes.length, tally, (offset, size) => {
      if (offset + size > blob.size) throw new ToolError("broken");
      patches.push({ at: offset, data: new Uint8Array(size) });
    });
    patches.push({ at: box.start, data: bytes });
  }
  patches.sort((a, b) => a.at - b.at);
  const pieces: BlobPart[] = [];
  let at = 0;
  for (const patch of patches) {
    if (patch.at < at) throw new ToolError("broken");
    pieces.push(blob.slice(at, patch.at), patch.data as Uint8Array<ArrayBuffer>);
    at = patch.at + patch.data.length;
  }
  pieces.push(blob.slice(at));
  return { blob: new Blob(pieces), report: { removed: tally.items(), kept: [{ code: "media-stream" }] } };
}

export async function inspectMp4Blob(blob: Blob): Promise<Finding[]> {
  const findings: Finding[] = [];
  const timed: Timed[] = [];
  try {
    for (const { bytes } of await readParts(blob)) walkInspect(bytes, 0, bytes.length, findings, timed);
  } catch {
    return findings;
  }
  for (const track of timed) {
    let budget = MAX_TIMED_READ;
    for (const [offset, size] of track.ranges) {
      if (budget <= 0) break;
      const data = await read(blob, offset, offset + Math.min(size, budget));
      budget -= data.length;
      if (data.some((b) => b)) {
        findings.push(other(track.name, data));
        break;
      }
    }
  }
  return findings;
}

import { ToolError } from "./tool.ts";
import { crc32 } from "./png-encode.ts";

// zip 的讀寫。Office（docx、xlsx、pptx）、ODF（odt、ods）與 EPUB 都是 zip。
//
// 讀：從檔尾的 End of Central Directory 找到中央目錄，列出每個檔案。解壓縮用瀏覽器內建的
// DecompressionStream，不另外帶套件。
//
// 寫：重新打包時，時間戳記統一成 1980-01-01 00:00，不寫附加欄位（附加欄位可能帶著建立者
// 電腦上的 Unix 使用者 ID、精確的修改時間），不寫 zip 與個別檔案的註解。檔案順序維持原樣，
// ODF 規定第一個檔案是不壓縮的 mimetype。

export interface ZipEntry {
  name: string;
  method: number; // 0 不壓縮、8 deflate
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  extraLength: number; // 中央目錄裡的附加欄位長度
  commentLength: number;
  madeBy: number; // 建立的系統：0 是 MS-DOS、3 是 Unix、19 是 macOS
  time: number; // MS-DOS 格式的修改時間與日期
  date: number;
}

export interface ZipArchive {
  entries: ZipEntry[];
  commentLength: number;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function findEnd(bytes: Uint8Array): number {
  const v = view(bytes);
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (v.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && findEnd(bytes) >= 0;
}

export function readZip(bytes: Uint8Array): ZipArchive {
  const end = findEnd(bytes);
  if (end < 0) throw new ToolError("broken");
  const v = view(bytes);
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdOffset = v.getUint32(end + 16, true);
  // ZIP64（超過 4 GB 或 65535 個檔案）先不支援
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ToolError("unsupported");
  if (cdOffset + cdSize > end) throw new ToolError("broken");
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let i = cdOffset;
  for (let n = 0; n < count; n++) {
    if (i + 46 > bytes.length || v.getUint32(i, true) !== 0x02014b50) throw new ToolError("broken");
    const flags = v.getUint16(i + 8, true);
    if (flags & 1) throw new ToolError("unsupported"); // 加密的 zip
    const nameLength = v.getUint16(i + 28, true);
    const extraLength = v.getUint16(i + 30, true);
    const commentLength = v.getUint16(i + 32, true);
    const entry: ZipEntry = {
      name: decoder.decode(bytes.subarray(i + 46, i + 46 + nameLength)),
      method: v.getUint16(i + 10, true),
      flags,
      crc: v.getUint32(i + 16, true),
      compressedSize: v.getUint32(i + 20, true),
      size: v.getUint32(i + 24, true),
      localOffset: v.getUint32(i + 42, true),
      extraLength,
      commentLength,
      madeBy: bytes[i + 5]!,
      time: v.getUint16(i + 12, true),
      date: v.getUint16(i + 14, true),
    };
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) {
      throw new ToolError("unsupported");
    }
    entries.push(entry);
    i += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, commentLength: v.getUint16(end + 20, true) };
}

// 只讀中央目錄的檔名，不解壓縮，判斷格式用
export function zipNames(bytes: Uint8Array): string[] | null {
  if (!isZip(bytes)) return null;
  try {
    return readZip(bytes).entries.map((e) => e.name);
  } catch {
    return null;
  }
}

function rawData(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const v = view(bytes);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || v.getUint32(at, true) !== 0x04034b50) throw new ToolError("broken");
  const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
  if (start + entry.compressedSize > bytes.length) throw new ToolError("broken");
  return bytes.subarray(start, start + entry.compressedSize);
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}

// 不壓縮的檔案直接取出，ODF 的 mimetype 判斷格式時用
export function storedData(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  return entry.method === 0 ? rawData(bytes, entry) : null;
}

export async function entryData(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const raw = rawData(bytes, entry);
  let data: Uint8Array;
  if (entry.method === 0) data = raw.slice();
  else if (entry.method === 8) data = await pipe(raw, new DecompressionStream("deflate-raw"));
  else throw new ToolError("unsupported");
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ToolError("broken");
  return data;
}

// MS-DOS 格式的日期時間，以兩秒為單位
export function dosDate(entry: ZipEntry): string | undefined {
  const { date, time } = entry;
  if (date === 0x21 && time === 0) return undefined; // 1980-01-01 00:00，清除過或沒有記錄
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${1980 + (date >> 9)}-${pad((date >> 5) & 15)}-${pad(date & 31)} ${pad(time >> 11)}:${pad((time >> 5) & 63)}:${pad((time & 31) * 2)}`;
}

export interface NewEntry {
  name: string;
  data: Uint8Array;
  compress: boolean;
}

export async function writeZip(entries: NewEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const body = entry.compress ? await pipe(entry.data, new CompressionStream("deflate-raw")) : entry.data;
    const crc = crc32(entry.data);
    const method = entry.compress ? 8 : 0;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 解壓縮需要的版本
    lv.setUint16(6, 0x0800, true); // 檔名是 UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // 時間 00:00
    lv.setUint16(12, 0x21, true); // 日期 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // 建立的版本，高位元組 0 代表 MS-DOS，不帶 Unix 權限與使用者
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

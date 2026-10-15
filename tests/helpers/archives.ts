import { concat } from "../../src/core/bytes.ts";
import { crc32 } from "../../src/core/png-encode.ts";
import { writeZip } from "../../src/core/zip.ts";
import { syntheticJpeg } from "./fixtures.ts";

// 壓縮檔、EPUB、種子檔與 HTML 的測試檔。真實的檔案在本機用 zip、tar、gzip 與 Python 產生來驗證，不進 repo。

const enc = new TextEncoder();
const b = (text: string) => enc.encode(text);

export const ARCHIVE_SECRETS = [
  "SECRET-WHEREFROM",
  "SECRET-DSSTORE",
  "SECRET-COMMENT",
  "janedoe",
  "SECRET-XATTR",
  "SECRET-NAME",
  "Jane Doe",
  "SECRET-PUBLISHER",
  "SECRET-ISBN",
  "SECRET-CLIENT",
  "secret.example",
  "SECRET-MODEL", // 壓縮檔裡照片的 EXIF
];

export const NOTE = b("VISIBLE-NOTE-CONTENT");

// 帶修改時間、Unix 附加欄位（UT）與註解的 ZIP，全部不壓縮
export function syntheticZip(): Uint8Array {
  const files: [string, Uint8Array][] = [
    ["notes.txt", NOTE],
    ["photos/", new Uint8Array()],
    ["photos/photo.jpg", syntheticJpeg({ trailer: false })],
    ["photos/.DS_Store", b("SECRET-DSSTORE")],
    ["__MACOSX/photos/._photo.jpg", b("com.apple.metadata:kMDItemWhereFroms SECRET-WHEREFROM")],
  ];
  const extra = concat([new Uint8Array([0x55, 0x54, 5, 0, 1]), new Uint8Array([0x80, 0x3b, 0x5b, 0x66])]);
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = b(name);
    const head = new Uint8Array(30);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 10, true);
    hv.setUint16(10, 0x5000, true); // 10:00
    hv.setUint16(12, (44 << 9) | (6 << 5) | 1, true); // 2024-06-01
    hv.setUint32(14, crc32(data), true);
    hv.setUint32(18, data.length, true);
    hv.setUint32(22, data.length, true);
    hv.setUint16(26, n.length, true);
    hv.setUint16(28, extra.length, true);
    const entry = concat([head, n, extra, data]);
    const cd = new Uint8Array(46);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, (3 << 8) | 30, true); // Unix
    cv.setUint16(6, 10, true);
    cv.setUint16(12, 0x5000, true);
    cv.setUint16(14, (44 << 9) | (6 << 5) | 1, true);
    cv.setUint32(16, crc32(data), true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(38, (0o100644 << 16) >>> 0, true);
    cv.setUint32(42, offset, true);
    central.push(concat([cd, n, extra]));
    local.push(entry);
    offset += entry.length;
  }
  const cdBytes = concat(central);
  const comment = b("SECRET-COMMENT");
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, comment.length, true);
  return concat([...local, cdBytes, end, comment]);
}

// --- TAR ---

function tarHeader(name: string, size: number, type: string, user = "janedoe"): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, text: string) => h.set(b(text), at);
  const octal = (at: number, length: number, value: number) => put(at, value.toString(8).padStart(length - 1, "0") + "\0");
  put(0, name);
  octal(100, 8, 0o644);
  octal(108, 8, 1000);
  octal(116, 8, 1000);
  octal(124, 12, size);
  octal(136, 12, 1717236000);
  put(156, type);
  put(257, "ustar\x0000");
  put(265, user);
  put(297, "staff");
  h.fill(0x20, 148, 156);
  const sum = h.reduce((n, x) => n + x, 0);
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

const pad = (data: Uint8Array) => concat([data, new Uint8Array((512 - (data.length % 512)) % 512)]);

// pax 的一筆：長度（含長度本身的位數）、空白、key=value、換行
function paxRecord(key: string, value: string) {
  const body = ` ${key}=${value}\n`;
  let length = body.length + String(body.length).length;
  if (String(length).length !== String(body.length).length) length = body.length + String(length).length;
  return `${length}${body}`;
}

export function syntheticTar(): Uint8Array {
  const pax = b(paxRecord("mtime", "1717236000.123") + paxRecord("SCHILY.xattr.com.apple.quarantine", "SECRET-XATTR") + paxRecord("path", "photo.jpg"));
  const photo = syntheticJpeg({ trailer: false });
  return concat([
    tarHeader("PaxHeader/photo.jpg", pax.length, "x"),
    pad(pax),
    tarHeader("photo.jpg", photo.length, "0"),
    pad(photo),
    tarHeader("._photo.jpg", 16, "0"),
    pad(b("SECRET-WHEREFROM")),
    tarHeader("notes.txt", NOTE.length, "0"),
    pad(NOTE),
    new Uint8Array(1024),
  ]);
}

// gzip：標頭帶著壓縮前的檔名與修改時間
export async function gzipWithName(data: Uint8Array): Promise<Uint8Array> {
  const body = new Uint8Array(await new Response(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const head = concat([new Uint8Array([0x1f, 0x8b, 8, 8, 0x20, 0xdc, 0x5a, 0x66, 0, 3]), b("SECRET-NAME.tar\0")]);
  const tail = new Uint8Array(8);
  new DataView(tail.buffer).setUint32(0, crc32(data), true);
  new DataView(tail.buffer).setUint32(4, data.length, true);
  return concat([head, body, tail]);
}

// --- EPUB ---

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-000000000000</dc:identifier>
<dc:identifier>978-SECRET-ISBN</dc:identifier>
<dc:title opf:file-as="Jane Doe title">VISIBLE-TITLE</dc:title>
<dc:language>zh-TW</dc:language>
<dc:creator>Jane Doe</dc:creator>
<dc:publisher>SECRET-PUBLISHER</dc:publisher>
<meta property="dcterms:modified">2024-06-01T10:00:00Z</meta>
<meta name="cover" content="cover"/>
</metadata>
<manifest><item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest>
<spine><itemref idref="ch"/></spine>
</package>`;

export const EPUB_BODY = "VISIBLE-BODY";

export function syntheticEpub(opts: { drm?: boolean } = {}): Promise<Uint8Array> {
  const files: [string, string | Uint8Array][] = [
    ["mimetype", "application/epub+zip"],
    [
      "META-INF/container.xml",
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
    ["OEBPS/content.opf", OPF],
    [
      "OEBPS/ch.xhtml",
      `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><meta name="author" content="Jane Doe"/></head><body><!-- SECRET-COMMENT --><p>${EPUB_BODY}</p></body></html>`,
    ],
    ["OEBPS/cover.jpg", syntheticJpeg({ trailer: false })],
    ["iTunesMetadata.plist", "<plist>janedoe@secret.example</plist>"],
    ...(opts.drm ? ([["META-INF/rights.xml", "<rights/>"]] as [string, string][]) : []),
  ];
  return writeZip(files.map(([name, data], i) => ({ name, data: typeof data === "string" ? b(data) : data, compress: i > 0 })));
}

// --- 種子檔 ---

type Bencode = number | string | Uint8Array | Bencode[] | { [key: string]: Bencode };

export function bencode(value: Bencode): Uint8Array {
  if (typeof value === "number") return b(`i${value}e`);
  if (typeof value === "string") return bencode(b(value));
  if (value instanceof Uint8Array) return concat([b(`${value.length}:`), value]);
  if (Array.isArray(value)) return concat([b("l"), ...value.map(bencode), b("e")]);
  return concat([b("d"), ...Object.keys(value).sort().flatMap((k) => [bencode(k), bencode(value[k]!)]), b("e")]);
}

const INFO = { length: 1234, name: "video.mp4", "piece length": 262144, pieces: new Uint8Array(20).fill(1) };
export const TORRENT_INFO = bencode(INFO);

export function syntheticTorrent(): Uint8Array {
  return bencode({
    announce: "udp://tracker.example.org:80",
    comment: "SECRET-COMMENT",
    "created by": "SECRET-CLIENT",
    "creation date": 1717236000,
    info: INFO,
    publisher: "Jane Doe",
  });
}

// --- HTML ---

export const HTML_SOURCE = `<!DOCTYPE html>
<!-- saved from url=(0035)https://secret.example/internal/page -->
<html><head><meta charset="utf-8"><meta name="author" content="Jane Doe"><meta name="generator" content="SECRET-CLIENT">
<meta property="og:url" content="https://secret.example/internal"><meta name="viewport" content="width=device-width">
<title>VISIBLE-TITLE</title><script>const s = "<!-- KEEP-IN-SCRIPT -->";</script></head>
<body><p>${EPUB_BODY}</p><!-- SECRET-COMMENT --></body></html>`;

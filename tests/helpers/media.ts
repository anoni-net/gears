import { concat } from "../../src/core/bytes.ts";
import { crc32 } from "../../src/core/png-encode.ts";

// 音訊與影片的測試檔：結構完整、在各處塞了秘密字串，聲音與影像的資料是可以辨認的假資料。
// 真實的檔案在本機用 ffmpeg 產生來驗證（清除後用 ffprobe 看標籤、比對解碼後的 MD5），不進 repo。

const enc = new TextEncoder();
const b = (text: string) => enc.encode(text);

export const MEDIA_SECRETS = [
  "SECRET-TITLE",
  "Jane Doe",
  "SECRET-COMMENT",
  "SECRET-PICTURE",
  "SECRET-PRIVATE",
  "SECRET-VENDOR",
  "SECRET-MAKE",
  "SECRET-MODEL",
  "SECRET-XMP",
  "SECRET-OLD",
  "SECRET-GPS",
  "+25.0330",
  "SECRET-JUNK",
  "SECRET-DATE",
  "SECRET-SOFT",
  "SECRET-STRD",
  "SECRET-NAME",
  "SECRET-MUX",
  "SECRET-WRITER",
  "SECRET-TRACK",
];

const u16be = (n: number) => new Uint8Array([n >> 8, n & 0xff]);
const u32be = (n: number) => new Uint8Array([n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
const u32le = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]);
const u24be = (n: number) => new Uint8Array([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

// --- ID3 與 MP3 ---

const syncsafe = (n: number) => new Uint8Array([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

function id3Frame(id: string, data: Uint8Array) {
  return concat([b(id), u32be(data.length), new Uint8Array(2), data]);
}

export function id3v2(): Uint8Array {
  const frames = concat([
    id3Frame("TIT2", concat([new Uint8Array([3]), b("SECRET-TITLE")])),
    id3Frame("TPE1", concat([new Uint8Array([1, 0xff, 0xfe]), new Uint8Array([...b("Jane Doe")].flatMap((c) => [c, 0]))])),
    id3Frame("COMM", concat([new Uint8Array([0]), b("eng"), new Uint8Array([0]), b("SECRET-COMMENT")])),
    id3Frame("APIC", concat([new Uint8Array([0]), b("image/jpeg\0"), new Uint8Array([3, 0]), b("SECRET-PICTURE")])),
    id3Frame("PRIV", b("SECRET-PRIVATE")),
    id3Frame("TRCK", concat([new Uint8Array([0]), b("1")])),
  ]);
  return concat([b("ID3"), new Uint8Array([3, 0, 0]), syncsafe(frames.length), frames]);
}

export function id3v1(): Uint8Array {
  const out = new Uint8Array(128);
  out.set(b("TAG"));
  out.set(b("SECRET-TITLE"), 3);
  out.set(b("Jane Doe"), 33);
  return out;
}

// MPEG-1 Layer III、128 kbps、44.1 kHz：每個音訊框 417 個位元組
export function mp3Frames(count = 3): Uint8Array {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    frame.set(b(`AUDIO-FRAME-${i}`), 36);
    frames.push(frame);
  }
  return concat(frames);
}

export function syntheticMp3(): Uint8Array {
  return concat([id3v2(), mp3Frames(), apeTag(), id3v1()]);
}

function apeTag(): Uint8Array {
  const item = concat([u32le(10), u32le(0), b("Artist\0"), b("SECRET-OLD")]);
  const footer = concat([b("APETAGEX"), u32le(2000), u32le(item.length + 32), u32le(1), u32le(0), new Uint8Array(8)]);
  return concat([item, footer]);
}

// --- MP4 ---

// box 的類型是 4 個位元組，© 是單一位元組 0xA9，不能用 UTF-8 編碼
const fourcc = (type: string) => new Uint8Array([...type].map((c) => c.charCodeAt(0)));

function box(type: string, ...payload: Uint8Array[]) {
  const body = concat(payload);
  return concat([u32be(8 + body.length), fourcc(type), body]);
}

// QuickTime 的 mdta：ilst 的項目用 keys 的索引當類型
function indexed(index: number, text: string) {
  const data = dataBox(text);
  return concat([u32be(8 + data.length), u32be(index), data]);
}

const full = (type: string, ...payload: Uint8Array[]) => box(type, new Uint8Array(4), ...payload);

// mvhd、tkhd、mdhd 版本 0：建立與修改時間各 4 個位元組（2024-06-01，從 1904 年起算的秒數）
const TIME_2024 = 3800000000;
const timed = (type: string, rest: number) => box(type, new Uint8Array([0, 0, 0, 0]), u32be(TIME_2024), u32be(TIME_2024), new Uint8Array(rest));

export const VIDEO_SAMPLE = b("VIDEO-SAMPLE-DATA");

function track(handler: string, codec: string, offset: number, sizes: number[]) {
  return box(
    "trak",
    timed("tkhd", 72),
    box(
      "mdia",
      timed("mdhd", 12),
      full("hdlr", new Uint8Array(4), b(handler), new Uint8Array(13)),
      box(
        "minf",
        box(
          "stbl",
          full("stsd", u32be(1), box(codec, new Uint8Array(8))),
          full("stsc", u32be(1), u32be(1), u32be(sizes.length), u32be(1)),
          full("stsz", u32be(0), u32be(sizes.length), ...sizes.map(u32be)),
          full("stco", u32be(1), u32be(offset)),
        ),
      ),
    ),
  );
}

function dataBox(text: string) {
  return box("data", u32be(1), u32be(0), b(text));
}

export function syntheticMp4(brand = "isom"): Uint8Array {
  const ftyp = box("ftyp", b(brand), u32be(0), b(brand));
  const gps = [b("SECRET-GPS-1"), b("SECRET-GPS-2")];
  const mdat = box("mdat", VIDEO_SAMPLE, ...gps);
  const mdatData = ftyp.length + 8;
  const qtMeta = box(
    "meta",
    full("hdlr", new Uint8Array(4), b("mdta"), new Uint8Array(13)),
    full(
      "keys",
      u32be(2),
      box("mdta", b("com.apple.quicktime.location.ISO6709")),
      box("mdta", b("com.apple.quicktime.model")),
    ),
    box("ilst", indexed(1, "+25.0330+121.5654+010.000/"), indexed(2, "SECRET-MODEL")),
  );
  const udta = box(
    "udta",
    box("©xyz", u16be(18), u16be(0x15c7), b("+25.0330+121.5654/")),
    box("©mak", u16be(11), u16be(0x15c7), b("SECRET-MAKE")),
    full("meta", full("hdlr", new Uint8Array(4), b("mdir"), new Uint8Array(13)), box("ilst", box("©nam", dataBox("SECRET-TITLE")), box("covr", dataBox("SECRET-PICTURE")))),
  );
  const xmp = box("uuid", new Uint8Array([0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac]), b("<x:xmpmeta>SECRET-XMP</x:xmpmeta>"));
  const moov = box(
    "moov",
    timed("mvhd", 88),
    track("vide", "avc1", mdatData, [VIDEO_SAMPLE.length]),
    track("meta", "mebx", mdatData + VIDEO_SAMPLE.length, gps.map((g) => g.length)),
    udta,
    qtMeta,
    box("free", b("SECRET-OLD-METADATA")),
  );
  return concat([ftyp, mdat, moov, xmp]);
}

// --- RIFF ---

function chunk(id: string, data: Uint8Array) {
  const head = concat([b(id), u32le(data.length)]);
  return data.length & 1 ? concat([head, data, new Uint8Array(1)]) : concat([head, data]);
}

const list = (form: string, ...chunks: Uint8Array[]) => chunk("LIST", concat([b(form), ...chunks]));
const riff = (form: string, ...chunks: Uint8Array[]) => chunk("RIFF", concat([b(form), ...chunks]));

export const PCM = b("AUDIO-PCM-SAMPLES");

export function syntheticWav(): Uint8Array {
  const bext = new Uint8Array(602);
  bext.set(b("SECRET-COMMENT"), 0);
  bext.set(b("Jane Doe"), 256);
  bext.set(b("2024-06-01"), 320);
  return concat([
    riff(
      "WAVE",
      chunk("fmt ", new Uint8Array([1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 16, 0])),
      list("INFO", chunk("INAM", b("SECRET-TITLE\0")), chunk("IART", b("Jane Doe\0")), chunk("ISFT", b("SECRET-SOFT\0"))),
      chunk("bext", bext),
      chunk("JUNK", b("SECRET-JUNK")),
      chunk("data", PCM),
      chunk("id3 ", id3v2()),
    ),
    id3v1(),
  ]);
}

export function syntheticAvi(): Uint8Array {
  return riff(
    "AVI ",
    list(
      "hdrl",
      chunk("avih", new Uint8Array(56)),
      list("strl", chunk("strh", new Uint8Array(56)), chunk("strf", new Uint8Array(40)), chunk("strd", b("SECRET-STRD")), chunk("strn", b("SECRET-NAME\0"))),
      chunk("IDIT", b("SECRET-DATE\0")),
    ),
    list("INFO", chunk("ISFT", b("SECRET-SOFT\0")), chunk("IART", b("Jane Doe\0"))),
    chunk("JUNK", b("SECRET-JUNK camera maker")),
    list("movi", chunk("00dc", VIDEO_SAMPLE)),
    chunk("idx1", concat([b("00dc"), u32le(0x10), u32le(4), u32le(VIDEO_SAMPLE.length)])),
  );
}

// --- FLAC ---

function flacBlock(type: number, data: Uint8Array, last = false) {
  return concat([new Uint8Array([(last ? 0x80 : 0) | type]), u24be(data.length), data]);
}

function vorbisComment(vendor: string, entries: string[]) {
  return concat([u32le(b(vendor).length), b(vendor), u32le(entries.length), ...entries.flatMap((e) => [u32le(b(e).length), b(e)])]);
}

const COMMENTS = ["TITLE=SECRET-TITLE", "ARTIST=Jane Doe", "LOCATION=+25.0330+121.5654/", "COMMENT=SECRET-COMMENT"];

export const FLAC_FRAMES = concat([new Uint8Array([0xff, 0xf8]), b("AUDIO-FLAC-FRAMES")]);

export function syntheticFlac(): Uint8Array {
  return concat([
    b("fLaC"),
    flacBlock(0, new Uint8Array(34).fill(7)),
    flacBlock(4, vorbisComment("SECRET-VENDOR", COMMENTS)),
    flacBlock(6, b("SECRET-PICTURE")),
    flacBlock(3, new Uint8Array(18).fill(9)),
    flacBlock(2, b("SECRET-PRIVATE")),
    flacBlock(1, new Uint8Array(16), true),
    FLAC_FRAMES,
  ]);
}

// --- Ogg ---

const OGG_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(page: Uint8Array): number {
  let crc = 0;
  for (const x of page) crc = ((crc << 8) ^ OGG_TABLE[((crc >>> 24) ^ x) & 0xff]!) >>> 0;
  return crc;
}

function oggPage(packets: Uint8Array[], seq: number, flags: number, granule = 0): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    for (let n = p.length; ; n -= 255) {
      lacing.push(Math.min(255, n));
      if (n < 255) break;
    }
  }
  const body = concat(packets);
  const page = new Uint8Array(27 + lacing.length + body.length);
  const view = new DataView(page.buffer);
  page.set(b("OggS"));
  page[5] = flags;
  view.setUint32(6, granule, true);
  view.setUint32(14, 0x1234, true);
  view.setUint32(18, seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  page.set(body, 27 + lacing.length);
  view.setUint32(22, oggCrc(page), true);
  return page;
}

export const OGG_AUDIO = [b("AUDIO-PACKET-1"), b("AUDIO-PACKET-2")];

export function syntheticOpus(): Uint8Array {
  const head = concat([b("OpusHead"), new Uint8Array([1, 2, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0])]);
  const picture = `METADATA_BLOCK_PICTURE=${"SECRET-PICTURE".repeat(40)}`;
  const tags = concat([b("OpusTags"), vorbisComment("SECRET-VENDOR", [...COMMENTS, picture])]);
  return concat([oggPage([head], 0, 2), oggPage([tags], 1, 0), oggPage([OGG_AUDIO[0]!], 2, 0, 960), oggPage([OGG_AUDIO[1]!], 3, 4, 1920)]);
}

export function syntheticVorbis(): Uint8Array {
  const id = concat([b("\x01vorbis"), new Uint8Array(23)]);
  const comment = concat([b("\x03vorbis"), vorbisComment("SECRET-VENDOR", COMMENTS), new Uint8Array([1])]);
  const setup = concat([b("\x05vorbis"), b("SETUP-CODEBOOKS")]);
  return concat([oggPage([id], 0, 2), oggPage([comment, setup], 1, 0), oggPage([OGG_AUDIO[0]!], 2, 0, 1024), oggPage([OGG_AUDIO[1]!], 3, 4, 2048)]);
}

// --- Matroska ---

function ebmlSize(n: number) {
  // 一律用 8 個位元組，好算
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] = 0x01;
  return out;
}

const UNKNOWN = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

function el(id: number[], ...data: Uint8Array[]) {
  const body = concat(data);
  return concat([new Uint8Array(id), ebmlSize(body.length), body]);
}

const crcOf = (data: Uint8Array) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, crc32(data), true);
  return out;
};

// 第一個子元素是 CRC-32 的母元素
function withCrc(id: number[], ...children: Uint8Array[]) {
  const body = concat(children);
  return el(id, el([0xbf], crcOf(body)), body);
}

export const MKV_BLOCK = b("VIDEO-BLOCK-DATA");

export function syntheticMkv(docType = "matroska", unknownSizes = false): Uint8Array {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], b(docType)));
  const date = new Uint8Array(8);
  new DataView(date.buffer).setBigInt64(0, 739_000_000_000_000_000n);
  const info = withCrc(
    [0x15, 0x49, 0xa9, 0x66],
    el([0x2a, 0xd7, 0xb1], u24be(1000000)),
    el([0x7b, 0xa9], b("SECRET-TITLE")),
    el([0x4d, 0x80], b("SECRET-MUX")),
    el([0x57, 0x41], b("SECRET-WRITER")),
    el([0x44, 0x61], date),
  );
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], new Uint8Array([1])), el([0x53, 0x6e], b("SECRET-TRACK")), el([0x86], b("V_TEST"))));
  const seek = el([0x11, 0x4d, 0x9b, 0x74], el([0x4d, 0xbb], el([0x53, 0xab], new Uint8Array([0x12, 0x54, 0xc3, 0x67])), el([0x53, 0xac], u32be(0))));
  const cluster = unknownSizes
    ? concat([new Uint8Array([0x1f, 0x43, 0xb6, 0x75]), UNKNOWN, el([0xe7], new Uint8Array([0])), el([0xa3], MKV_BLOCK)])
    : el([0x1f, 0x43, 0xb6, 0x75], el([0xe7], new Uint8Array([0])), el([0xa3], MKV_BLOCK));
  const attachments = el([0x19, 0x41, 0xa4, 0x69], el([0x61, 0xa7], el([0x46, 0x6e], b("font.ttf")), el([0x46, 0x5c], b("FONT-DATA"))));
  const simple = (name: string, value: string) => el([0x67, 0xc8], el([0x45, 0xa3], b(name)), el([0x44, 0x87], b(value)));
  const tags = el([0x12, 0x54, 0xc3, 0x67], el([0x73, 0x73], simple("ARTIST", "Jane Doe"), simple("LOCATION", "+25.0330+121.5654/"), simple("COMMENT", "SECRET-COMMENT")));
  const body = concat([seek, info, tracks, cluster, attachments, tags]);
  const segment = unknownSizes
    ? concat([new Uint8Array([0x18, 0x53, 0x80, 0x67]), UNKNOWN, body])
    : el([0x18, 0x53, 0x80, 0x67], body);
  return concat([header, segment]);
}

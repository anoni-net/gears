import { ascii, u32be } from "../../core/bytes.ts";
import { id3v2Size, syncsafe } from "../../core/media.ts";
import type { Finding, FindingCode } from "../../core/tool.ts";
import { other } from "./preview.ts";

// ID3：MP3 的標籤，也會出現在 WAV、FLAC、AAC 的開頭。v2 在檔案開頭，v1 是檔尾的 128 個位元組。

const FRAMES: Record<string, FindingCode | null> = {};
const group = (code: FindingCode | null, ids: string) => ids.split(" ").forEach((id) => (FRAMES[id] = code));
group("text", "TIT2 TT2 TALB TAL TIT1 TT1 TIT3 TT3");
group("owner", "TPE1 TP1 TPE2 TP2 TPE3 TP3 TPE4 TP4 TCOM TCM TEXT TXT TOPE TOA TOLY TOL TPUB TPB TCOP TCR TOWN TENC TEN");
group("datetime", "TYER TYE TDAT TDA TIME TIM TDRC TDOR TORY TOR TDEN TDRL TDTG");
group("software", "TSSE TSS");
group("comment", "COMM COM USLT ULT");
group("thumbnail", "APIC PIC");
// 曲目編號、類型、長度這類跟身分無關的不列
group(null, "TRCK TRK TPOS TPA TCON TCO TLEN TLE TBPM TBP TKEY TKE TLAN TLA TFLT TFT TMED TMT TSRC TRC TCMP TSO2 TSOA TSOP TSOT");

function decodeText(data: Uint8Array): string {
  const encoding = data[0];
  const body = data.subarray(1);
  let text: string;
  if (encoding === 1) text = new TextDecoder(body[0] === 0xfe ? "utf-16be" : "utf-16le").decode(body);
  else if (encoding === 2) text = new TextDecoder("utf-16be").decode(body);
  else if (encoding === 3) text = new TextDecoder().decode(body);
  else text = new TextDecoder("latin1").decode(body);
  return text.replace(/^﻿/, "");
}

// 一個 0xFF 後面接的 0x00 是為了避開同步碼插進去的，讀之前拿掉
function deunsync(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    out.push(data[i]!);
    if (data[i] === 0xff && data[i + 1] === 0x00) i++;
  }
  return new Uint8Array(out);
}

export function id3v2Findings(bytes: Uint8Array, at: number): Finding[] {
  const size = id3v2Size(bytes, at);
  if (!size) return [];
  const version = bytes[at + 3]!;
  const flags = bytes[at + 5]!;
  let tag = bytes.subarray(at + 10, at + 10 + syncsafe(bytes, at + 6));
  if (version < 4 && flags & 0x80) tag = deunsync(tag);
  let i = 0;
  if (flags & 0x40) i = version === 3 ? 4 + u32be(tag, 0) : version === 4 ? syncsafe(tag, 0) : 0;
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  const findings: Finding[] = [];
  while (i + headerLength <= tag.length && tag[i] !== 0) {
    const id = ascii(tag, i, idLength);
    const length =
      version === 2 ? (tag[i + 3]! << 16) | (tag[i + 4]! << 8) | tag[i + 5]! : version === 4 ? syncsafe(tag, i + 4) : u32be(tag, i + 4);
    const formatFlags = version === 2 ? 0 : tag[i + 9]!;
    let data = tag.subarray(i + headerLength, i + headerLength + length);
    i += headerLength + length;
    const code = id in FRAMES ? FRAMES[id] : "other";
    if (code === null) continue;
    // 壓縮或加密的欄位讀不到內容，只列出有這一項
    const unreadable = (version === 3 && formatFlags & 0xc0) || (version === 4 && formatFlags & 0x0c);
    if (code === "other") {
      findings.push(other(id, unreadable ? undefined : data));
      continue;
    }
    if (code === "thumbnail" || unreadable) {
      findings.push({ code });
      continue;
    }
    // v2.4 的單一欄位可以各自做同步碼處理、加上資料長度
    if (version === 4 && formatFlags & 0x02) data = deunsync(data);
    if (version === 4 && formatFlags & 0x01) data = data.subarray(4);
    // COMM、USLT：編碼、語系（3）、描述、內容，描述與內容用 0 隔開
    const text = code === "comment" ? decodeText(new Uint8Array([data[0]!, ...data.subarray(4)])) : decodeText(data);
    const parts = text.split("\0").filter(Boolean);
    const value = (code === "comment" ? parts.at(-1) : parts[0])?.trim().slice(0, 80);
    findings.push({ code, value: value || undefined });
  }
  return findings;
}

// ID3v1：TAG、標題（30）、演出者（30）、專輯（30）、年份（4）、註解（30）、類型（1）
export function id3v1Findings(bytes: Uint8Array, at: number): Finding[] {
  const field = (offset: number, length: number) =>
    new TextDecoder("latin1").decode(bytes.subarray(at + offset, at + offset + length)).replace(/\0.*$/s, "").trim() || undefined;
  const findings: Finding[] = [];
  const add = (code: FindingCode, value: string | undefined) => value && findings.push({ code, value });
  add("text", field(3, 30));
  add("owner", field(33, 30));
  add("text", field(63, 30));
  add("datetime", field(93, 4));
  add("comment", field(97, 28));
  return findings;
}

import { type TimeValue, emailTime } from "../verify/times.ts";

// 電子郵件的原始檔（.eml，或從郵件軟體「顯示原始郵件」複製的文字）。只讀，不連網：
// 寄件驗證只讀收件伺服器已經記在信裡的結果，不自己查 DNS。
//
// 結構是一段標頭、一個空行、接著內文。標頭可以折成好幾行（下一行以空白開頭），非英文的
// 文字寫成 =?UTF-8?B?…?= 這種編碼。內文是 MIME，可能一層包一層，附件用 base64 編碼。

export interface Header {
  name: string;
  value: string; // 展開折行、解開編碼之後的值
}

export interface Address {
  name?: string;
  address: string;
  domain: string; // 小寫
}

export interface Hop {
  from?: string;
  by?: string;
  with?: string;
  ip?: string;
  time?: TimeValue;
}

export interface AuthResult {
  method: string; // spf、dkim、dmarc、arc……
  result: string; // pass、fail、softfail、none……
  props: Record<string, string>; // header.from、smtp.mailfrom、header.d 這類
}

export interface AuthRecord {
  authserv: string; // 記下結果的伺服器
  results: AuthResult[];
  arc: boolean; // 來自 ARC-Authentication-Results（轉寄時保留的前一站結果）
}

export interface Attachment {
  name: string;
  type: string;
  data: Uint8Array;
}

export interface Message {
  headers: Header[];
  from?: Address;
  replyTo: Address[];
  to: Address[];
  returnPath?: string;
  subject?: string;
  date?: TimeValue;
  messageId?: string;
  mailer?: string;
  received: Hop[]; // 跟標頭的順序相同：最上面是最後一站（收件的伺服器）
  auth: AuthRecord[];
  dkimDomains: string[];
  attachments: Attachment[];
  links: string[];
  hasBody: boolean;
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const toBytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

function decodeCharset(bytes: Uint8Array, charset = "utf-8"): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// 標頭裡直接寫 UTF-8 的位元組（現在很常見），用 latin1 讀進來之後要轉回去
function fixRaw(value: string): string {
  if (!/[\x80-\xff]/.test(value)) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(toBytes(value));
  } catch {
    return value;
  }
}

function decodeQ(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "_") out.push(0x20);
    else if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return toBytes(atob(clean.slice(0, clean.length - (clean.length % 4)) || ""));
  } catch {
    return new Uint8Array(0);
  }
}

// =?charset?B?…?= 與 =?charset?Q?…?=，相鄰的編碼字之間的空白不算
export function decodeWords(value: string): string {
  return fixRaw(value)
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) =>
      decodeCharset(enc.toUpperCase() === "B" ? decodeBase64(text) : decodeQ(text), charset),
    );
}

function parseHeaders(block: string): Header[] {
  const headers: Header[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers.at(-1)!.value += ` ${line.trim()}`;
      continue;
    }
    const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (m) headers.push({ name: m[1]!, value: m[2]! });
  }
  return headers.map((h) => ({ name: h.name, value: decodeWords(h.value.trim()) }));
}

// 依逗號分開，引號與角括號裡的逗號不算
function splitList(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let angle = 0;
  for (const c of value) {
    if (c === '"') quote = !quote;
    else if (!quote && c === "<") angle++;
    else if (!quote && c === ">") angle = Math.max(0, angle - 1);
    if (c === "," && !quote && !angle) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseAddress(text: string): Address | undefined {
  const angle = /^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(text.trim());
  const address = angle ? angle[2]! : /([^\s<>"]+@[^\s<>"]+)/.exec(text)?.[1];
  if (!address) return undefined;
  const name = angle?.[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
  return { name: name || undefined, address, domain: address.split("@").pop()!.toLowerCase().replace(/[>.]+$/, "") };
}

const addresses = (value: string | undefined) => (value ? splitList(value).map(parseAddress).filter((a): a is Address => !!a) : []);

// 拿掉括號裡的註解，Authentication-Results 與 Received 都會用
const stripComments = (text: string) => {
  let out = text;
  for (let i = 0; i < 3; i++) out = out.replace(/\([^()]*\)/g, " ");
  return out.replace(/\s+/g, " ").trim();
};

export function parseAuth(value: string, arc = false): AuthRecord {
  const segments = value.split(";").map((s) => s.trim());
  // ARC 的開頭多一段 i=1
  if (arc && /^i=\d+$/.test(segments[0] ?? "")) segments.shift();
  const authserv = stripComments(segments.shift() ?? "").split(" ")[0] ?? "";
  const results: AuthResult[] = [];
  for (const seg of segments) {
    const clean = stripComments(seg);
    const m = /^([a-z0-9-]+)\s*=\s*([a-z]+)\s*(.*)$/i.exec(clean);
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const p of m[3]!.matchAll(/([a-z0-9.-]+)=("[^"]*"|\S+)/gi)) props[p[1]!.toLowerCase()] = p[2]!.replace(/^"|"$/g, "");
    results.push({ method: m[1]!.toLowerCase(), result: m[2]!.toLowerCase(), props });
  }
  return { authserv, results, arc };
}

export function parseReceived(value: string): Hop {
  const semi = value.lastIndexOf(";");
  const main = semi >= 0 ? value.slice(0, semi) : value;
  const hop: Hop = { time: semi >= 0 ? emailTime(value.slice(semi + 1)) : undefined };
  const word = (key: string) => new RegExp(`(?:^|\\s)${key}\\s+([^\\s;]+)`, "i").exec(stripComments(main))?.[1];
  hop.from = word("from");
  hop.by = word("by");
  hop.with = word("with");
  // IP 位址通常寫在 from 後面的括號裡：(mail.example.com [192.0.2.1])
  const fromPart = /(?:^|\s)from\s+([\s\S]*?)(?:\sby\s|$)/i.exec(main)?.[1] ?? "";
  hop.ip = /\[(?:IPv6:)?([0-9a-f.:]+)\]/i.exec(fromPart)?.[1];
  return hop;
}

function params(value: string): { main: string; params: Record<string, string> } {
  const parts: string[] = [];
  let cur = "";
  let quote = false;
  for (const c of value) {
    if (c === '"') quote = !quote;
    if (c === ";" && !quote) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  const out: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const m = /^\s*([^=\s]+)\s*=\s*(.*)$/.exec(p);
    if (m) out[m[1]!.toLowerCase()] = m[2]!.trim().replace(/^"(.*)"$/, "$1");
  }
  return { main: (parts[0] ?? "").trim().toLowerCase(), params: out };
}

// RFC 2231：filename*=UTF-8''%E6%AA%94.pdf，也可能拆成 filename*0*=、filename*1*=
function paramText(p: Record<string, string>, key: string): string | undefined {
  if (p[key]) return decodeWords(p[key]!);
  const pieces = Object.keys(p)
    .filter((k) => k.startsWith(`${key}*`))
    .sort((a, b) => (Number(/\*(\d+)/.exec(a)?.[1] ?? 0) - Number(/\*(\d+)/.exec(b)?.[1] ?? 0)));
  if (!pieces.length) return undefined;
  const encoded = pieces.some((k) => k.endsWith("*"));
  let joined = pieces.map((k) => p[k]!).join("");
  let charset = "utf-8";
  if (encoded) {
    const m = /^([^']*)'[^']*'(.*)$/.exec(joined);
    if (m) {
      charset = m[1] || "utf-8";
      joined = m[2]!;
    }
    return decodeCharset(toBytes(decodeURIComponentBytes(joined)), charset);
  }
  return joined;
}

function decodeURIComponentBytes(text: string): string {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function decodeBody(body: string, encoding: string): Uint8Array {
  const enc = encoding.trim().toLowerCase();
  if (enc === "base64") return decodeBase64(body);
  if (enc === "quoted-printable") return decodeQ(body.replace(/=\r?\n/g, "").replace(/_/g, "=5F"));
  return toBytes(body);
}

const LINK = /https?:\/\/[^\s"'<>()[\]{}]+/gi;

interface Collected {
  attachments: Attachment[];
  texts: string[];
}

function walk(raw: string, collected: Collected, depth = 0) {
  const split = /\r?\n\r?\n/.exec(raw);
  const headers = parseHeaders(split ? raw.slice(0, split.index) : raw);
  const body = split ? raw.slice(split.index + split[0].length) : "";
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value;
  const type = params(get("content-type") ?? "text/plain");
  const disposition = params(get("content-disposition") ?? "");
  if (type.main.startsWith("multipart/") && type.params.boundary && depth < 8) {
    const boundary = `--${type.params.boundary}`;
    const parts = body.split(new RegExp(`\\r?\\n?${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?[ \\t]*\\r?\\n?`));
    for (const part of parts.slice(1)) if (part.trim()) walk(part, collected, depth + 1);
    return;
  }
  if (type.main === "message/rfc822" && depth < 8) {
    // 轉寄的信當成附件，原樣交出來
    collected.attachments.push({ name: paramText(disposition.params, "filename") ?? "message.eml", type: type.main, data: toBytes(body) });
    return;
  }
  const name = paramText(disposition.params, "filename") ?? paramText(type.params, "name");
  const data = decodeBody(body, get("content-transfer-encoding") ?? "7bit");
  if (name || disposition.main === "attachment" || !type.main.startsWith("text/")) {
    collected.attachments.push({ name: name ?? `attachment-${collected.attachments.length + 1}`, type: type.main, data });
  } else {
    collected.texts.push(decodeCharset(data, type.params.charset));
  }
}

const unescapeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d));

export function parseEmail(input: Uint8Array | string): Message {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  // mbox 匯出的信開頭多一行「From 寄件人 時間」，沒有冒號
  const raw = latin1(bytes).replace(/^[\s﻿]+/, "").replace(/^From [^\r\n]*\r?\n/, "");
  const split = /\r?\n\r?\n/.exec(raw);
  const head = split ? raw.slice(0, split.index) : raw;
  const headers = parseHeaders(head);
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value;
  const all = (name: string) => headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);

  const collected: Collected = { attachments: [], texts: [] };
  const hasBody = !!split && raw.slice(split.index + split[0].length).trim().length > 0;
  if (hasBody) {
    try {
      walk(raw, collected);
    } catch {
      // 內文結構壞掉時只看標頭
    }
  }
  const links = new Set<string>();
  for (const text of collected.texts) {
    for (const m of unescapeHtml(text).matchAll(LINK)) {
      if (links.size >= 50) break;
      links.add(m[0].replace(/[.,;:!?]+$/, ""));
    }
  }

  const dkimDomains = all("dkim-signature")
    .map((v) => /(?:^|;)\s*d=([^;\s]+)/i.exec(v)?.[1]?.toLowerCase())
    .filter((d): d is string => !!d);

  return {
    headers,
    from: addresses(get("from"))[0],
    replyTo: addresses(get("reply-to")),
    to: addresses(get("to")),
    returnPath: /<([^<>]*)>/.exec(get("return-path") ?? "")?.[1] ?? get("return-path"),
    subject: get("subject"),
    date: emailTime(get("date")),
    messageId: get("message-id"),
    mailer: get("x-mailer") ?? get("user-agent"),
    received: all("received").map(parseReceived),
    auth: [...all("authentication-results").map((v) => parseAuth(v)), ...all("arc-authentication-results").map((v) => parseAuth(v, true))],
    dkimDomains: [...new Set(dkimDomains)],
    attachments: collected.attachments,
    links: [...links],
    hasBody,
  };
}

export { looksLikeEmail } from "../../core/email-sniff.ts";

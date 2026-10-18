// QR code 讀取的純邏輯：解讀 QR code 裡常見的內容格式。影像解碼在 src/ui/qr-scan.ts。
//
// 認得的格式見 AGENTS.md「QR code 的內容格式」。讀者在打開之前先看到這張 QR code 會做什麼：
// 撥給誰、傳什麼簡訊、付款給哪個地址，有風險的格式在畫面上另外提醒。

import type { QrKind } from "../qrcode/formats.ts";
import { type BoardingPassContent, type InvoiceBarcodeContent, type ProductContent, parseBoardingPass, parseInvoiceBarcode, parseProduct } from "./barcode.ts";
import { type BridgeContent, type InviteContent, type PasskeyContent, type ProxyContent, parseBridges, parseInvite, parsePasskey, parseProxy } from "./network.ts";
import { type MerchantPayContent, type TwPayContent, parseMerchantPay, parseTwPay } from "./pay.ts";

export type Coin = "bitcoin" | "monero" | "zcash";

export interface InvoiceItem {
  name: string;
  qty: string;
  price: string;
}

export type QrContent =
  | { kind: "url"; url: string }
  | { kind: "wifi"; ssid: string; password: string; security: string; hidden: boolean }
  | { kind: "contact"; name: string; org: string; title: string; phones: string[]; emails: string[]; urls: string[]; address: string; note: string }
  | { kind: "email"; to: string; subject: string; body: string }
  | { kind: "phone"; number: string }
  | { kind: "sms"; number: string; message: string }
  | { kind: "geo"; lat: string; lng: string }
  | { kind: "event"; title: string; start: string; end: string; location: string; description: string }
  | { kind: "otp"; type: string; issuer: string; account: string }
  | { kind: "payment"; coin: Coin; address: string; amount: string; label: string; message: string }
  | { kind: "invoice"; number: string; date: string; random: string; total: string; buyer: string; seller: string; items: InvoiceItem[]; itemTotal: number; foreign: boolean }
  | { kind: "invoice-more"; items: InvoiceItem[] }
  | BridgeContent
  | PasskeyContent
  | ProxyContent
  | InviteContent
  | TwPayContent
  | MerchantPayContent
  | BoardingPassContent
  | ProductContent
  | InvoiceBarcodeContent
  | { kind: "text"; text: string };

// 格式清單（使用統計用）要跟 kind 一致，兩個方向都檢查
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const kindsMatch: Same<QrContent["kind"], QrKind> = true;
void kindsMatch;

// jsQR 用 decodeURIComponent 解開位元組，不是 UTF-8 的那一段會變成空字串。台灣的電子發票
// 與一些舊系統用 Big5，這時改用位元組自己解：先試 UTF-8，不是的話當成 Big5
interface Chunk {
  type: string;
  bytes?: number[];
  text?: string;
}

export function qrText(result: { data: string; binaryData: number[]; chunks: Chunk[] }): string {
  const lost = result.chunks.some((c) => c.type === "byte" && c.bytes?.length && !c.text);
  if (!lost) return result.data;
  const bytes = new Uint8Array(result.binaryData);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("big5").decode(bytes);
  }
}

// WIFI:、MECARD:、MATMSG: 共用的寫法：前綴之後是「鍵:值;」，反斜線跳脫特殊字元，
// 最後以兩個分號結束。同一個鍵可以出現好幾次（MECARD 的 TEL）
function parseFields(text: string, prefix: number): [string, string][] {
  const fields: [string, string][] = [];
  let key = "";
  let value = "";
  let readingKey = true;
  for (let i = prefix; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      value += text[++i];
    } else if (readingKey && ch === ":") {
      readingKey = false;
    } else if (readingKey) {
      key += ch;
    } else if (ch === ";") {
      if (key) fields.push([key.trim().toUpperCase(), value]);
      key = "";
      value = "";
      readingKey = true;
    } else {
      value += ch;
    }
  }
  if (!readingKey && key) fields.push([key.trim().toUpperCase(), value]);
  return fields;
}

const first = (fields: [string, string][], key: string) => fields.find(([k]) => k === key)?.[1] ?? "";
const all = (fields: [string, string][], key: string) => fields.filter(([k, v]) => k === key && v).map(([, v]) => v);

// Wi-Fi 格式：WIFI:T:WPA;S:名稱;P:密碼;H:true;;，反斜線跳脫特殊字元
export function parseWifi(text: string): Extract<QrContent, { kind: "wifi" }> | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields = parseFields(text, 5);
  if (!fields.some(([k]) => k === "S")) return null;
  return {
    kind: "wifi",
    ssid: first(fields, "S"),
    password: first(fields, "P"),
    security: first(fields, "T") || "nopass",
    hidden: first(fields, "H").toLowerCase() === "true",
  };
}

const hasCjk = (s: string) => /[㐀-鿿豈-﫿]/.test(s);

// 姓與名分開寫的時候，中日文姓在前、不加空白，其他語言名在前
const joinName = (family: string, given: string) => (hasCjk(family + given) ? family + given : [given, family].filter(Boolean).join(" "));

// MECARD:N:姓,名;TEL:…;EMAIL:…;;，日本手機起頭的聯絡人格式
function parseMecard(text: string): QrContent | null {
  if (!/^MECARD:/i.test(text)) return null;
  const f = parseFields(text, 7);
  const [family = "", given = ""] = first(f, "N").split(",");
  return {
    kind: "contact",
    name: joinName(family, given),
    org: first(f, "ORG"),
    title: "",
    phones: all(f, "TEL"),
    emails: all(f, "EMAIL"),
    urls: all(f, "URL"),
    address: first(f, "ADR"),
    note: first(f, "NOTE"),
  };
}

// MATMSG:TO:…;SUB:…;BODY:…;;，早期 Android 用的 Email 格式
function parseMatmsg(text: string): QrContent | null {
  if (!/^MATMSG:/i.test(text)) return null;
  const f = parseFields(text, 7);
  return { kind: "email", to: first(f, "TO"), subject: first(f, "SUB"), body: first(f, "BODY") };
}

interface Property {
  name: string;
  params: string[];
  value: string;
}

// vCard 與 iCalendar 的內容行：「名稱;參數:值」，以空白或 tab 開頭的行接在上一行後面
function contentLines(text: string): Property[] {
  const out: Property[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const [head = "", ...params] = line.slice(0, colon).split(";");
    // Apple 的 vCard 會在名稱前面加上群組，例如 item1.URL
    const name = head.slice(head.lastIndexOf(".") + 1).toUpperCase();
    let value = line.slice(colon + 1);
    if (params.some((p) => /^ENCODING=QUOTED-PRINTABLE$/i.test(p))) value = decodeQuotedPrintable(value);
    out.push({ name, params, value });
  }
  return out;
}

// vCard 2.1 的 Android 匯出會把中文寫成 quoted-printable 的 UTF-8
function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  const raw = s.replace(/=\n/g, "");
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(raw[i]!));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const unescapeText = (s: string) => s.replace(/\\([nN\\;,])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

// 結構化的值（N、ADR）以沒有跳脫的分號分欄
const components = (s: string) => s.split(/(?<!\\);/).map((part) => unescapeText(part).trim());

function parseVcard(text: string): QrContent | null {
  if (!/^BEGIN:VCARD/i.test(text.trim())) return null;
  const props = contentLines(text);
  const get = (name: string) => props.find((p) => p.name === name)?.value ?? "";
  const many = (name: string) => props.filter((p) => p.name === name && p.value.trim()).map((p) => unescapeText(p.value).trim());
  const [family = "", given = ""] = components(get("N"));
  return {
    kind: "contact",
    name: unescapeText(get("FN")).trim() || joinName(family, given),
    org: components(get("ORG")).filter(Boolean).join(" "),
    title: unescapeText(get("TITLE")).trim(),
    phones: many("TEL"),
    emails: many("EMAIL"),
    // URL 是網址型別，值裡的逗號與分號不是跳脫過的
    urls: props.filter((p) => p.name === "URL" && p.value.trim()).map((p) => p.value.trim()),
    address: components(get("ADR")).filter(Boolean).join(", "),
    note: unescapeText(get("NOTE")).trim(),
  };
}

// iCalendar 的時間：20261020T190000 是當地時間，結尾 Z 是 UTC，TZID 參數帶時區名稱，
// 只有日期的是整天的活動
export function formatIcalTime(value: string, params: string[] = []): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z)?)?$/.exec(value.trim());
  if (!m) return value.trim();
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return date;
  const tz = m[6] ? " UTC" : (params.find((p) => /^TZID=/i.test(p))?.slice(5).replace(/"/g, "") ?? "");
  return `${date} ${m[4]}:${m[5]}${tz && !tz.startsWith(" ") ? ` ${tz}` : tz}`;
}

function parseEvent(text: string): QrContent | null {
  const trimmed = text.trim();
  if (!/^BEGIN:(VEVENT|VCALENDAR)/i.test(trimmed) || !/BEGIN:VEVENT/i.test(trimmed)) return null;
  const props = contentLines(trimmed.slice(trimmed.search(/BEGIN:VEVENT/i)));
  const prop = (name: string) => props.find((p) => p.name === name);
  const time = (name: string) => {
    const p = prop(name);
    return p ? formatIcalTime(p.value, p.params) : "";
  };
  return {
    kind: "event",
    title: unescapeText(prop("SUMMARY")?.value ?? "").trim(),
    start: time("DTSTART"),
    end: time("DTEND"),
    location: unescapeText(prop("LOCATION")?.value ?? "").trim(),
    description: unescapeText(prop("DESCRIPTION")?.value ?? "").trim(),
  };
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// 查詢字串自己拆，不用 URLSearchParams：mailto 與付款網址裡的加號是字面上的加號
function query(s: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (s ?? "").split("&")) {
    const eq = pair.indexOf("=");
    if (eq > 0) out.set(decode(pair.slice(0, eq)).toLowerCase(), decode(pair.slice(eq + 1)));
  }
  return out;
}

function parseMailto(text: string): QrContent | null {
  const m = /^mailto:([^?]*)(?:\?(.*))?$/is.exec(text.trim());
  if (!m) return null;
  const q = query(m[2]);
  const to = [decode(m[1]!), q.get("to") ?? ""].filter(Boolean).join(",");
  return { kind: "email", to, subject: q.get("subject") ?? "", body: (q.get("body") ?? "").replace(/\r\n/g, "\n") };
}

function parseTel(text: string): QrContent | null {
  const m = /^tel:(.+)$/i.exec(text.trim());
  return m ? { kind: "phone", number: decode(m[1]!) } : null;
}

// SMSTO:號碼:內容（ZXing）、sms:號碼?body=內容（RFC 5724），iOS 也會寫成 sms:號碼&body=
function parseSms(text: string): QrContent | null {
  const t = text.trim();
  const zxing = /^(?:SMSTO|MMSTO):([^:]*)(?::([\s\S]*))?$/i.exec(t);
  if (zxing) return { kind: "sms", number: zxing[1]!, message: zxing[2] ?? "" };
  const uri = /^sms:([^?&]*)(?:[?&](.*))?$/is.exec(t);
  if (uri) return { kind: "sms", number: decode(uri[1]!), message: query(uri[2]).get("body") ?? "" };
  return null;
}

function parseGeo(text: string): QrContent | null {
  const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i.exec(text.trim());
  if (!m || Math.abs(Number(m[1])) > 90 || Math.abs(Number(m[2])) > 180) return null;
  return { kind: "geo", lat: m[1]!, lng: m[2]! };
}

// 兩步驟驗證的金鑰：otpauth://totp/服務:帳號?secret=…&issuer=…。金鑰本身不拆出來顯示
function parseOtp(text: string): QrContent | null {
  const m = /^otpauth:\/\/(totp|hotp)\/([^?]*)(?:\?(.*))?$/i.exec(text.trim());
  if (!m) return null;
  const label = decode(m[2]!);
  const colon = label.indexOf(":");
  const q = query(m[3]);
  return {
    kind: "otp",
    type: m[1]!.toUpperCase(),
    issuer: q.get("issuer") ?? (colon >= 0 ? label.slice(0, colon).trim() : ""),
    account: (colon >= 0 ? label.slice(colon + 1) : label).trim(),
  };
}

// 付款網址：bitcoin:（BIP 21）、monero:、zcash:（ZIP 321）。金額與附註的參數名稱各家不同
function parsePayment(text: string): QrContent | null {
  const m = /^(bitcoin|monero|zcash):([^?]+)(?:\?(.*))?$/i.exec(text.trim());
  if (!m) return null;
  const q = query(m[3]);
  return {
    kind: "payment",
    coin: m[1]!.toLowerCase() as Coin,
    address: decode(m[2]!).replace(/^\/\//, ""),
    amount: q.get("amount") ?? q.get("tx_amount") ?? "",
    label: q.get("label") ?? q.get("recipient_name") ?? "",
    message: q.get("message") ?? q.get("tx_description") ?? "",
  };
}

// 台灣的電子發票證明聯左右各一個 QR code，規格見財政部的《電子發票證明聯一維及二維條碼規格說明》
// Ver 1.9。左邊前 77 碼是固定欄位：字軌號碼 10、民國年月日 7、隨機碼 4、未稅與含稅金額
// 各 8（十六進位）、買方與賣方統一編號各 8、加密驗證 24。接著以冒號分隔：營業人自行使用區、
// 兩個 QR code 記載的品目筆數、發票的品目總筆數、中文編碼參數（0 Big5、1 UTF-8、2 Base64、
// 3 境外電商的 UTF-8），再來是「品名:數量:單價」。左邊放不下的接在右邊，右邊以 ** 開頭
const INVOICE = /^([A-Z]{2}\d{8})(\d{3})(\d{2})(\d{2})(\d{4})([0-9A-Fa-f]{8})([0-9A-Fa-f]{8})(\d{8})(\d{8})(.{24})/;

const hexAmount = (s: string) => String(parseInt(s, 16));

// 境外電商的金額是 8 碼整數加 2 碼小數，各自用十六進位
function foreignAmount(s: string): string {
  if (!/^[0-9A-Fa-f]{10}$/.test(s)) return "";
  const cents = parseInt(s.slice(8), 16);
  return `${parseInt(s.slice(0, 8), 16)}.${String(cents).padStart(2, "0")}`;
}

// Base64 的品項從冒號之後一路接到右邊的 QR code，只讀左邊時取到 4 的倍數為止
function decodeBase64Prefix(s: string): string {
  const usable = s.slice(0, s.length - (s.length % 4));
  try {
    const bin = atob(usable);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

const NUMBER = /^-?\d+(\.\d+)?$/;

// 「品名:數量:單價」一組一組讀。右邊的 QR code 可能從上一組的數量接起，開頭對不上的跳過，
// 品項讀完之後的補充說明也不算
function invoiceItems(fields: string[]): InvoiceItem[] {
  const items: InvoiceItem[] = [];
  for (let i = 0; i + 2 < fields.length; ) {
    const [name, qty, price] = [fields[i]!, fields[i + 1]!, fields[i + 2]!];
    if (name && !NUMBER.test(name) && NUMBER.test(qty) && NUMBER.test(price)) {
      items.push({ name, qty, price });
      i += 3;
    } else {
      i++;
    }
  }
  return items;
}

function parseInvoice(text: string): QrContent | null {
  // 右邊的 QR code：接著左邊的「品名:數量:單價」，或是 Base64 的後半段
  if (/^\*\*(?:[^*:\n]*:\d|[A-Za-z0-9+/]+=*$)/.test(text)) {
    const body = text.slice(2);
    const plain = body.includes(":") ? body : decodeBase64Prefix(body);
    return { kind: "invoice-more", items: invoiceItems(plain.split(":")) };
  }
  const m = INVOICE.exec(text);
  if (!m || (text.length > 77 && text[77] !== ":")) return null;
  const month = Number(m[3]);
  const day = Number(m[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const rest = text.slice(77).split(":");
  // rest[0] 是第 77 碼之後、第一個冒號之前，正常是空的
  const [, , , itemTotalField = "", encoding = "", ...fields] = rest;
  const foreign = encoding === "3";
  let itemFields = fields;
  let total = hexAmount(m[7]!);
  if (foreign) {
    total = foreignAmount(fields[1] ?? "");
    itemFields = fields.slice(2);
  } else if (encoding === "2") {
    itemFields = decodeBase64Prefix(fields.join(":")).split(":");
  }
  const items = invoiceItems(itemFields);
  return {
    kind: "invoice",
    number: `${m[1]!.slice(0, 2)}-${m[1]!.slice(2)}`,
    date: `${Number(m[2]) + 1911}-${m[3]}-${m[4]}`,
    random: m[5]!,
    total,
    buyer: m[8] === "00000000" ? "" : m[8]!,
    seller: m[9]!,
    items,
    itemTotal: Number(itemTotalField) || items.length,
    foreign,
  };
}

const PARSERS: ((text: string) => QrContent | null)[] = [
  parseInvoice,
  parseBoardingPass,
  parseWifi,
  parseMecard,
  parseMatmsg,
  parseVcard,
  parseEvent,
  parseMailto,
  parseTel,
  parseSms,
  parseGeo,
  parseOtp,
  parsePayment,
  parsePasskey,
  parseTwPay,
  parseMerchantPay,
  parseProxy,
  parseBridges,
  parseInvite,
];

// format 是條碼的種類（zxing 的名稱，例如 EAN13、Code39），QR code 是 QRCode。
// 商品條碼與發票的一維條碼只有一串數字，要看條碼的種類才分得出來
export function classify(text: string, format = "QRCode"): QrContent {
  const barcode = parseProduct(text, format) ?? parseInvoiceBarcode(text, format);
  if (barcode) return barcode;
  for (const parse of PARSERS) {
    const content = parse(text);
    if (content) return content;
  }
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return { kind: "url", url: trimmed };
  return { kind: "text", text };
}

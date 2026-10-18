// QR code 讀取的純邏輯：解讀 QR code 裡常見的內容格式。影像解碼在 src/ui/qr-scan.ts。
//
// 認得的格式見 AGENTS.md「QR code 的內容格式」。讀者在打開之前先看到這張 QR code 會做什麼：
// 撥給誰、傳什麼簡訊、付款給哪個地址，有風險的格式在畫面上另外提醒。

export type Coin = "bitcoin" | "monero" | "zcash";

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
  | { kind: "text"; text: string };

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

const PARSERS = [parseWifi, parseMecard, parseMatmsg, parseVcard, parseEvent, parseMailto, parseTel, parseSms, parseGeo, parseOtp, parsePayment];

export function classify(text: string): QrContent {
  for (const parse of PARSERS) {
    const content = parse(text);
    if (content) return content;
  }
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return { kind: "url", url: trimmed };
  return { kind: "text", text };
}

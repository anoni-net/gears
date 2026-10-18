import qrcode from "qrcode-generator";
import { encodeBilevelPng } from "../../core/png-encode.ts";

// QR code 產生器的純邏輯，介面在 src/ui/QrTool.tsx。
//
// 編碼交給 qrcode-generator。編碼寫錯的典型後果是產生一個掃得出來、內容卻錯的
// 碼，所以用成熟的實作，測試再把產生的圖解碼回文字比對（tests/unit/qrcode.spec.ts）。

export type Ecc = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  size: number;
  dark: boolean[]; // size × size，逐列排列
}

export class QrTooLong extends Error {
  constructor() {
    super("too long");
    this.name = "QrTooLong";
  }
}

// 函式庫的 Byte 模式把字串的每個字元當成一個位元組（Latin-1），中文直接傳進去會
// 變成亂碼。先轉成 UTF-8，再把每個位元組寫成一個字元交給它。
export function encodeQr(text: string, ecc: Ecc): QrMatrix {
  let binary = "";
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  const qr = qrcode(0, ecc);
  qr.addData(binary, "Byte");
  try {
    qr.make();
  } catch {
    throw new QrTooLong();
  }
  const size = qr.getModuleCount();
  const dark: boolean[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark.push(qr.isDark(r, c));
  return { size, dark };
}

export const MARGIN = 4; // 規格要求四格寬的白邊

export function qrPath(m: QrMatrix): string {
  let d = "";
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark[r * m.size + c]) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
    }
  }
  return d;
}

export function qrSvg(m: QrMatrix): string {
  const n = m.size + MARGIN * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(m)}" fill="#000"/></svg>`
  );
}

// 每格放大成 scale × scale 個像素
export function qrPng(m: QrMatrix, scale = 10): Uint8Array {
  const n = (m.size + MARGIN * 2) * scale;
  return encodeBilevelPng(n, n, (x, y) => {
    const c = Math.floor(x / scale) - MARGIN;
    const r = Math.floor(y / scale) - MARGIN;
    return c >= 0 && r >= 0 && c < m.size && r < m.size && m.dark[r * m.size + c]!;
  });
}

// Wi-Fi 的 QR code 格式，手機相機掃到會直接詢問要不要連線。
// 反斜線、分號、逗號、冒號與雙引號要跳脫。
export type WifiSecurity = "WPA" | "WEP" | "nopass";

export function wifiPayload(opts: { ssid: string; password: string; security: WifiSecurity; hidden: boolean }): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
  let text = `WIFI:T:${opts.security};S:${esc(opts.ssid)};`;
  if (opts.security !== "nopass") text += `P:${esc(opts.password)};`;
  if (opts.hidden) text += "H:true;";
  return `${text};`;
}

// 其他常見的內容格式。手機的相機與掃描 App 認得這幾種，掃到之後會直接帶出對應的動作：
// 存成聯絡人、加進行事曆、打開地圖、寫信、撥號、傳簡訊。格式跟著 ZXing 的慣例走，
// 這是 Android 與 iOS 都認得的寫法（AGENTS.md「QR code 的內容格式」）。
//
// 每個函式在欄位不夠時回傳 null（預覽顯示提示），格式不對時回傳 error（顯示原因）。
export type InputError = "phone" | "email" | "coords" | "eventOrder";
export type Payload = { text: string } | { error: InputError } | null;

// vCard 與 iCalendar 的文字欄位要跳脫反斜線、分號、逗號與換行
const escText = (s: string) => s.replace(/([\;,])/g, "\\$1").replace(/\r?\n/g, "\\n");
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

// 電話號碼去掉空白、連字號、括號與點，剩下的只能是數字與 +、*、#
export function normalizePhone(input: string): string | null {
  const n = input.replace(/[\s\-().]/g, "");
  return /^\+?[0-9*#]+$/.test(n) ? n : null;
}

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// 多個收件人用逗號、分號或空白分開
function normalizeEmails(input: string): string | null {
  const list = input.split(/[\s,;]+/).filter(Boolean);
  return list.length && list.every((a) => EMAIL.test(a)) ? list.join(",") : null;
}

export interface Contact {
  name: string;
  phone: string;
  email: string;
  org: string;
  url: string;
}

// vCard 3.0，iOS 與 Android 都認得。姓名整串放在 N 的姓氏欄，中文姓名不拆成姓與名。
// URL 是網址型別，不跳脫逗號。
export function vcardPayload(c: Contact): Payload {
  const name = oneLine(c.name);
  const org = oneLine(c.org);
  const url = oneLine(c.url);
  if (!name && !c.phone.trim() && !c.email.trim() && !org) return null;
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escText(name)};;;;`, `FN:${escText(name || org)}`];
  if (org) lines.push(`ORG:${escText(org)}`);
  if (c.phone.trim()) {
    const phone = normalizePhone(c.phone);
    if (!phone) return { error: "phone" };
    lines.push(`TEL:${phone}`);
  }
  if (c.email.trim()) {
    if (!EMAIL.test(c.email.trim())) return { error: "email" };
    lines.push(`EMAIL:${c.email.trim()}`);
  }
  if (url) lines.push(`URL:${url}`);
  lines.push("END:VCARD");
  return { text: lines.join("\n") };
}

// mailto 的主旨與內容用百分比編碼。加號在 mailto 裡是字面上的加號，不能當空白
export function mailtoPayload(opts: { to: string; subject: string; body: string }): Payload {
  if (!opts.to.trim()) return null;
  const to = normalizeEmails(opts.to);
  if (!to) return { error: "email" };
  const query = [
    opts.subject ? `subject=${encodeURIComponent(opts.subject)}` : "",
    opts.body ? `body=${encodeURIComponent(opts.body.replace(/\r?\n/g, "\r\n"))}` : "",
  ].filter(Boolean);
  return { text: `mailto:${to}${query.length ? `?${query.join("&")}` : ""}` };
}

export function telPayload(number: string): Payload {
  if (!number.trim()) return null;
  const n = normalizePhone(number);
  return n ? { text: `tel:${n}` } : { error: "phone" };
}

// SMSTO:號碼:內容，Android 與 iOS 的相機都認得。內容裡的冒號不必跳脫，第二個冒號之後都是內容
export function smsPayload(opts: { number: string; message: string }): Payload {
  if (!opts.number.trim()) return null;
  const n = normalizePhone(opts.number);
  if (!n) return { error: "phone" };
  return { text: opts.message ? `SMSTO:${n}:${opts.message}` : `SMSTO:${n}` };
}

// 從「緯度, 經度」讀出座標。地圖 App 長按地點複製出來的就是這個格式，網址裡的
// `@25.03,121.56,17z`、`ll=25.03,121.56` 與 geo: 開頭的也讀得到
export function parseCoordinates(input: string): { lat: string; lng: string } | null {
  const m = /(-?\d{1,3}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(input);
  if (!m) return null;
  const [lat, lng] = [m[1]!, m[2]!];
  if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) return null;
  return { lat, lng };
}

export function geoPayload(input: string): Payload {
  if (!input.trim()) return null;
  const c = parseCoordinates(input);
  return c ? { text: `geo:${c.lat},${c.lng}` } : { error: "coords" };
}

// datetime-local 的值（2026-10-20T19:00）轉成 iCalendar 的 20261020T190000。
// 不帶時區，掃描的手機會當成它所在地的時間
const icalTime = (v: string) => `${v.replace(/[-:]/g, "").slice(0, 13)}00`;

export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
  location: string;
}

export function eventPayload(e: CalendarEvent): Payload {
  const title = oneLine(e.title);
  if (!title || !e.start) return null;
  if (e.end && e.end < e.start) return { error: "eventOrder" };
  const lines = ["BEGIN:VEVENT", `SUMMARY:${escText(title)}`, `DTSTART:${icalTime(e.start)}`];
  if (e.end) lines.push(`DTEND:${icalTime(e.end)}`);
  if (oneLine(e.location)) lines.push(`LOCATION:${escText(oneLine(e.location))}`);
  lines.push("END:VEVENT");
  return { text: lines.join("\n") };
}

// 檔案裡各種寫法的時間，統一成「字面上的時間＋時區」。查證時要保留檔案寫的原貌：
// 沒有寫時區的時間不猜時區，只依字面排序，畫面上另外標出。

export interface TimeValue {
  text: string; // 2024-06-01 10:00:00（秒數沒寫時補 00）
  offset?: string; // +08:00，UTC 寫成 +00:00。沒有寫時區時留空
  sort: number; // 排序用的毫秒數：有時區時是 UTC，沒有時把字面當成 UTC
}

const pad = (n: number) => String(n).padStart(2, "0");

function build(y: number, mo: number, d: number, h: number, mi: number, s: number, offset?: string): TimeValue | undefined {
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 60) return undefined;
  // 相機沒設定時間時常寫成 0000:00:00 或 1970 年前後，照樣列出，由讀者判斷
  const text = `${String(y).padStart(4, "0")}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(Math.floor(s))}`;
  let sort = Date.UTC(y, mo - 1, d, h, mi, Math.floor(s));
  if (offset) {
    const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
    if (!m) return { text, sort };
    const minutes = (Number(m[2]) * 60 + Number(m[3])) * (m[1] === "-" ? -1 : 1);
    sort -= minutes * 60000;
    offset = `${m[1]}${m[2]}:${m[3]}`;
  }
  return { text, offset, sort };
}

function zone(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (text === "Z" || text === "z") return "+00:00";
  return /^[+-]\d{2}:?\d{2}$/.test(text) ? text : undefined;
}

// EXIF：2024:06:01 10:00:00，時區另外放在 OffsetTime 系列的欄位（+08:00）
export function exifTime(text: string | undefined, offset?: string): TimeValue | undefined {
  const m = text && /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return undefined;
  return build(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, +m[6]!, zone(offset?.trim()));
}

// EXIF 的 GPS 時間：日期 2024:06:01、時間是三個有理數，一律是 UTC
export function gpsTime(date: string | undefined, time: [number, number, number] | undefined): TimeValue | undefined {
  const m = date && /^(\d{4}):(\d{2}):(\d{2})/.exec(date.trim());
  if (!m || !time) return undefined;
  return build(+m[1]!, +m[2]!, +m[3]!, Math.floor(time[0]), Math.floor(time[1]), time[2], "+00:00");
}

// ISO 8601（XMP、Office、ODF）：2024-06-01T10:00:00+08:00，可能只有日期或只到分鐘，小數秒略去
export function isoTime(text: string | undefined): TimeValue | undefined {
  const m = text && /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(text.trim());
  if (!m) return undefined;
  return build(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), zone(m[7]?.toUpperCase()));
}

// PDF：D:20240601100000+08'00'，後面的欄位都可以省略。Z 或 Z00'00' 是 UTC
export function pdfTime(text: string | undefined): TimeValue | undefined {
  const m = text && /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?/.exec(text.trim());
  if (!m) return undefined;
  const offset = m[7] ? "+00:00" : m[8] ? `${m[8]}${m[9]}:${m[10] ?? "00"}` : undefined;
  return build(+m[1]!, +(m[2] ?? 1), +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), offset);
}

// 清除中繼資料的檢查結果裡的時間（各格式自己整理過的寫法），能認的就認
export function anyTime(text: string | undefined): TimeValue | undefined {
  if (!text) return undefined;
  return isoTime(text) ?? exifTime(text) ?? (/^D:/.test(text.trim()) ? pdfTime(text) : undefined);
}

// 電子郵件的 Date 與 Received：Thu, 16 Oct 2026 10:02:46 +0800，時區也可能寫成 GMT、UT、PST 這類縮寫。
// CST 在 RFC 822 是美國中部時間，台灣與中國的伺服器卻常用來表示 +08:00，有歧義，當成沒有時區
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ZONE_NAMES: Record<string, string> = {
  UT: "+00:00", UTC: "+00:00", GMT: "+00:00", Z: "+00:00",
  EST: "-05:00", EDT: "-04:00", CDT: "-05:00", MST: "-07:00", MDT: "-06:00", PST: "-08:00", PDT: "-07:00",
};

export function emailTime(text: string | undefined): TimeValue | undefined {
  const m = text && /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]{1,3})?/.exec(text);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  let year = +m[3]!;
  if (year < 100) year += year < 50 ? 2000 : 1900;
  const zone = m[7] ? (/^[+-]\d{4}$/.test(m[7]) ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : ZONE_NAMES[m[7].toUpperCase()]) : undefined;
  // -0000 是「時區不明」，當成沒有時區
  return build(year, month, +m[1]!, +m[4]!, +m[5]!, +(m[6] ?? 0), m[7] === "-0000" ? undefined : zone);
}


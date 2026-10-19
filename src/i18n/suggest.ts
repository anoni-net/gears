import type { Locale } from "./index.ts";

// 瀏覽器偏好的語言跟網址的語系不同時，建議換成哪一個（src/ui/LocaleHint.tsx）。
// 讀者的語言清單裡有目前的語系就不建議：在台灣把系統設成英文、清單裡也有 zh-TW 的人，
// 每次打開都看到「切換到英文」會很煩。
// 中文分不出字系時（只有 zh）不猜。其他語言建議英文，比中文更可能讀得懂
export function localeOfLanguage(tag: string): Locale | null {
  const lower = tag.toLowerCase();
  if (lower === "zh") return null;
  if (lower.startsWith("zh")) {
    if (/-(hant|tw|hk|mo)\b/.test(lower)) return "zh-TW";
    if (/-(hans|cn|sg|my)\b/.test(lower)) return "zh-CN";
    return null;
  }
  return "en";
}

export function suggestLocale(languages: readonly string[], current: Locale): Locale | null {
  const mapped = languages.map(localeOfLanguage);
  if (mapped.includes(current)) return null;
  const first = mapped.find((l) => l !== null);
  return first && first !== current ? first : null;
}

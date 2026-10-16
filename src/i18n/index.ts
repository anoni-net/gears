import { en } from "./en.ts";
import { zhCN } from "./zh-CN.ts";
import { type MessageKey, zhTW } from "./zh-TW.ts";

export type { MessageKey };

// 介面語系由網址決定：/gears/ 是正體中文，/gears/zh-cn/、/gears/en/ 是簡體中文與英文，
// 跟文件站一樣。不用 cookie 或 localStorage 記住選擇，換語系就是換網址。
export const LOCALES = [
  { id: "zh-TW", prefix: "", lang: "zh-Hant-TW", label: "正體中文" },
  { id: "zh-CN", prefix: "zh-cn/", lang: "zh-Hans", label: "简体中文" },
  { id: "en", prefix: "en/", lang: "en", label: "English" },
] as const;

export type Locale = (typeof LOCALES)[number]["id"];

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { "zh-TW": zhTW, "zh-CN": zhCN, en };

// 單元測試在 Node 裡執行，沒有 Vite 注入的 import.meta.env
const BASE = import.meta.env?.BASE_URL ?? "/gears/";

export function localeFromPath(pathname: string): Locale {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : "";
  return LOCALES.find((l) => l.prefix && rest.startsWith(l.prefix))?.id ?? "zh-TW";
}

let current: Locale = typeof location === "undefined" ? "zh-TW" : localeFromPath(location.pathname);

export const getLocale = () => current;
export const localeInfo = (id: Locale = current) => LOCALES.find((l) => l.id === id)!;

export function setLocale(id: Locale) {
  current = id;
  if (typeof document !== "undefined") document.documentElement.lang = localeInfo(id).lang;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text = MESSAGES[current][key];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

// 介面裡用到、但鍵是組出來的字串，例如 finding.location。找不到時回傳鍵本身，
// 測試會抓到。
export function tDynamic(key: string, vars?: Record<string, string | number>): string {
  return key in MESSAGES[current] ? t(key as MessageKey, vars) : key;
}

// 列舉：中文用頓號，英文用逗號
export const list = (items: string[]) => items.join(t("list.separator"));

// 建置時產生每個語系的頁面用（vite.config.ts）
export const messagesOf = (id: Locale) => MESSAGES[id];

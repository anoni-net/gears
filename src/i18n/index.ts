import { type MessageKey, zhTW } from "./zh-TW.ts";

export type { MessageKey };

// 第一版只有正體中文。字串從一開始就集中在語系檔，補上簡體與英文時不必改元件。
const messages: Record<MessageKey, string> = zhTW;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text = messages[key];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
  return text;
}

// 介面裡用到、但鍵是組出來的字串，例如 finding.location。找不到時回傳鍵本身，
// 測試會抓到。
export function tDynamic(key: string, vars?: Record<string, string | number>): string {
  return key in messages ? t(key as MessageKey, vars) : key;
}

export const lang = "zh-Hant-TW";

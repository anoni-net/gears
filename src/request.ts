// 需求表單：頁尾的「提出需求」連到社群自架的 Formbricks，每個語系一份問卷。
// 用連結在新分頁打開，不嵌進頁面：CSP 不必多開對外連線，暫存區的檔案也留著。
// 網址帶上目前的工具、語系與版本（問卷的 hidden fields），維護者整理時對照得到，
// 讀者的檔案與輸入一律不帶。onion 版連到 onion 的表單，讀者不必離開 Tor 網路
import type { Locale } from "./i18n/index.ts";
import { IS_ONION, ONION_HOST } from "./site.ts";

// 問卷的 id 在 Formbricks 的網址裡（/s/<id>），換問卷時改這裡
export const REQUEST_SURVEYS: Record<Locale, string> = {
  "zh-TW": "cmvd7x9nx000h01o1ore46k5v",
  "zh-CN": "cmvd7xhpq000i01o1aow3g3q5",
  en: "cmvd7xi3z000j01o1o3a5wh32",
};

export const FORM_ORIGIN = IS_ONION ? `http://form.${ONION_HOST}` : "https://form.anoni.net";

// tool 是目前畫面的工具 id，桌面寫成 home
export function requestUrl(tool: string, locale: Locale, version: string, origin = FORM_ORIGIN): string {
  const params = new URLSearchParams({ tool: tool || "home", locale, version });
  return `${origin}/s/${REQUEST_SURVEYS[locale]}?${params}`;
}

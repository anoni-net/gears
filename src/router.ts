import { useEffect, useState } from "preact/hooks";
import { type Locale, getLocale, localeFromPath, localeInfo, setLocale } from "./i18n/index.ts";
import { NOT_FOUND, pageIds } from "./pages.ts";
import { toolIds } from "./tools/index.ts";

// 每個工具有自己的網址（/gears/qrcode/），可以被搜尋到，也可以直接分享。
// 建置時 vite.config.ts 替每個工具產生一份 HTML，標題與描述各自不同，
// 不需要伺服器的轉址設定。

const BASE = import.meta.env.BASE_URL; // "/gears/"

// "" 是桌面，其他是工具的 id。網址前面可能有語系（/gears/en/qrcode/）。
// 認不得的網址是 NOT_FOUND（nginx 送出 404.html 時），不當成桌面，讀者才知道網址打錯了
export function parseRoute(pathname: string): string {
  const prefix = localeInfo(localeFromPath(pathname)).prefix;
  const rest = pathname.startsWith(BASE + prefix) ? pathname.slice(BASE.length + prefix.length) : "";
  const id = rest.replace(/\/+$/, "").split("/")[0] ?? "";
  if (id === "" || id === "index.html") return "";
  return toolIds.includes(id) || pageIds.includes(id) ? id : NOT_FOUND;
}

export function routeUrl(id: string, locale: Locale = getLocale()): string {
  return `${BASE}${localeInfo(locale).prefix}${id ? `${id}/` : ""}`;
}

const EVENT = "gears:navigate";

// 換頁時捲回頂端。只換網址與畫面的話，瀏覽器沿用原本的捲動位置：手機上從桌面下方點進比較長的頁面
// （建議與回饋），畫面會停在新頁面的最底部。上一頁由瀏覽器自己還原捲動位置，換語系留在原處，都不經過這裡
export function navigate(id: string) {
  if (parseRoute(location.pathname) === id) return;
  history.pushState(null, "", routeUrl(id));
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

// 換語系：留在同一個工具，網址換成那個語系的，不重新載入，暫存區的檔案留著
export function switchLocale(locale: Locale) {
  if (locale === getLocale()) return;
  // 找不到的頁面沒有其他語系的網址，換到那個語系的桌面
  const id = parseRoute(location.pathname).replace(NOT_FOUND, "");
  setLocale(locale);
  history.pushState(null, "", routeUrl(id, locale));
  window.dispatchEvent(new Event(EVENT));
}

export function useRoute(): string {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  // 語系也算在狀態裡，上一頁回到另一個語系時整個畫面跟著換
  const [, setLocaleState] = useState(getLocale());
  useEffect(() => {
    const update = () => {
      setLocale(localeFromPath(location.pathname));
      setLocaleState(getLocale());
      setRoute(parseRoute(location.pathname));
    };
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}

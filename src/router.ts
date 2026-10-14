import { useEffect, useState } from "preact/hooks";
import { toolIds } from "./tools/index.ts";

// 每個工具有自己的網址（/gears/qrcode/），可以被搜尋到，也可以直接分享。
// 建置時 vite.config.ts 替每個工具產生一份 HTML，標題與描述各自不同，
// 不需要伺服器的轉址設定。

const BASE = import.meta.env.BASE_URL; // "/gears/"

// "" 是桌面，其他是工具的 id
export function parseRoute(pathname: string): string {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : "";
  const id = rest.replace(/\/+$/, "").split("/")[0] ?? "";
  return toolIds.includes(id) ? id : "";
}

export function routeUrl(id: string): string {
  return id ? `${BASE}${id}/` : BASE;
}

const EVENT = "gears:navigate";

export function navigate(id: string) {
  if (parseRoute(location.pathname) === id) return;
  history.pushState(null, "", routeUrl(id));
  window.dispatchEvent(new Event(EVENT));
}

export function useRoute(): string {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}

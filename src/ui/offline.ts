import { useEffect, useState } from "preact/hooks";

// 註冊 service worker（src/sw/sw-template.js），回報離線是否可用、有沒有等著換上的新版本。
// 開發伺服器不註冊，免得改了程式卻一直拿到舊的。

export interface OfflineState {
  ready: boolean; // 這個頁面已經由 service worker 提供，沒有網路也能開啟
  update: (() => void) | null; // 有新版本時，換上並重新載入
}

// 讀者按了「重新載入」才換版本。第一次開啟時 service worker 接手頁面也會觸發
// controllerchange，那時候重新載入會把剛放進暫存區的檔案清掉
let requested = false;

export function useOffline(): OfflineState {
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let alive = true;
    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && sw.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        next?.addEventListener("statechange", () => {
          // 第一次安裝不算更新，已經有 controller 才是換版本
          if (alive && next.state === "installed" && sw.controller) setWaiting(next);
        });
      });
    };
    sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        watch(reg);
        return sw.ready;
      })
      .then(() => alive && setReady(true))
      .catch(() => {});
    const onChange = () => {
      if (requested) location.reload();
    };
    sw.addEventListener("controllerchange", onChange);
    return () => {
      alive = false;
      sw.removeEventListener("controllerchange", onChange);
    };
  }, []);

  return {
    ready,
    update: waiting
      ? () => {
          requested = true;
          waiting.postMessage("skipWaiting");
        }
      : null,
  };
}

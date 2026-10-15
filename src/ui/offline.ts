import { useEffect, useState } from "preact/hooks";

// 註冊 service worker（src/sw/sw-template.js），回報離線是否可用、有沒有等著換上的新版本。
// 開發伺服器不註冊，免得改了程式卻一直拿到舊的。

export interface OfflineState {
  ready: boolean; // 這個頁面已經由 service worker 提供，沒有網路也能開啟
  update: (() => void) | null; // 有新版本時，換上並重新載入
  updating: boolean; // 按了重新載入，等新版本接手
  updated: boolean; // 這次載入是剛換上新版本
  dismissUpdated: () => void;
}

// 讀者按了「重新載入」才換版本。第一次開啟時 service worker 接手頁面也會觸發
// controllerchange，那時候重新載入會把剛放進暫存區的檔案清掉
let requested = false;
let reloading = false;

// 新版本接手之後通常馬上收到 controllerchange。等著的那一版已經被更新的一版取代、
// 或瀏覽器沒有切換時收不到，超過這個時間就直接重新載入，按鈕不會停在那裡沒有反應
const FALLBACK_MS = 4000;

// 重新載入之後告訴讀者已經換上新版本。記在 history.state，重新載入時會保留，
// 不寫進 localStorage 這類會留在裝置上的地方
const UPDATED = "gearsUpdated";

function reload() {
  if (reloading) return;
  reloading = true;
  history.replaceState({ ...(history.state ?? {}), [UPDATED]: true }, "");
  location.reload();
}

export function useOffline(): OfflineState {
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updated, setUpdated] = useState(() => !!history.state?.[UPDATED]);

  useEffect(() => {
    if (!updated) return;
    const { [UPDATED]: _, ...rest } = history.state ?? {};
    history.replaceState(Object.keys(rest).length ? rest : null, "");
  }, []);

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
      if (requested) reload();
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
      ? async () => {
          if (requested) return;
          requested = true;
          setUpdating(true);
          setTimeout(reload, FALLBACK_MS);
          // 按下時再查一次，提示出現之後可能又有更新的一版裝好了
          const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
          const next = reg?.waiting ?? (waiting.state === "installed" ? waiting : null);
          if (next) next.postMessage("skipWaiting");
          else reload();
        }
      : null,
    updating,
    updated,
    dismissUpdated: () => setUpdated(false),
  };
}

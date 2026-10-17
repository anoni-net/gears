import { useEffect, useState } from "preact/hooks";
import type { TraySnapshot } from "../core/tray.ts";

// 註冊 service worker（src/sw/sw-template.js），回報離線是否可用、有沒有等著換上的新版本。
// 開發伺服器不註冊，免得改了程式卻一直拿到舊的。
//
// 換版本要重新載入頁面，暫存區只在記憶體裡，重新載入就沒了。所以：
// - 暫存區是空的、畫面上也沒有填到一半的東西（idle）時，等分頁切到背景就直接換，不出現提示
// - 有檔案時，讀者按下重新載入，新版本接手之後先把暫存區交給它在記憶體裡暫放，重新載入的頁面再拿回來。
//   暫放失敗就不重新載入，提示讀者先下載需要的檔案

export interface OfflineState {
  ready: boolean; // 這個頁面已經由 service worker 提供，沒有網路也能開啟
  update: (() => void) | null; // 有新版本時，換上並重新載入
  updating: boolean; // 按了重新載入，等新版本接手
  carryFailed: boolean; // 沒辦法把暫存區帶到新版本，再按一次會直接重新載入
  updated: "kept" | "lost" | "plain" | null; // 這次載入是剛換上新版本，暫存區有沒有帶過來
  dismissUpdated: () => void;
}

// 換版本時暫存區怎麼交出去、怎麼放回來（src/app.tsx 接上 src/state.ts 的 tray）
export interface Carry {
  snapshot(): TraySnapshot | null;
  restore(snapshot: TraySnapshot): void;
}

// 讀者按了「重新載入」才換版本。第一次開啟時 service worker 接手頁面也會觸發
// controllerchange，那時候重新載入會把剛放進暫存區的檔案清掉
let requested = false;
let finishing = false;
let reloading = false;
let silent = false;
// 收到 skipWaiting 的新版本
let incoming: ServiceWorker | null = null;

// 新版本接手之後通常馬上收到 controllerchange。等著的那一版已經被更新的一版取代、
// 或瀏覽器沒有切換時收不到，超過這個時間就直接重新載入，按鈕不會停在那裡沒有反應
const FALLBACK_MS = 4000;
// 交給 service worker 暫放或拿回來，超過這個時間沒有回應就當成失敗
const ASK_MS = 5000;

// 重新載入之後告訴讀者已經換上新版本、暫存區有沒有帶過來。記在 history.state，重新載入時會保留，
// 不寫進 localStorage 這類會留在裝置上的地方
const UPDATED = "gearsUpdated";
const CARRIED = "gearsCarried";

function ask<T>(target: ServiceWorker, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("timeout")), ASK_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as T);
    };
    target.postMessage(message, [channel.port2]);
  });
}

function reload(carried: boolean) {
  if (reloading) return;
  reloading = true;
  history.replaceState({ ...(history.state ?? {}), [UPDATED]: !silent, [CARRIED]: carried }, "");
  location.reload();
}

export function useOffline(idle: boolean, carry: Carry): OfflineState {
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const [carryFailed, setCarryFailed] = useState(false);
  const [updated, setUpdated] = useState<OfflineState["updated"]>(() => {
    const s = history.state ?? {};
    if (s[CARRIED]) return null; // 拿回暫存區之後才知道
    return s[UPDATED] ? "plain" : null;
  });

  // 新版本接手之後，把暫存區交給它暫放再重新載入。暫放失敗就停下來，讓讀者先下載
  const finish = async () => {
    if (finishing || reloading) return;
    finishing = true;
    const snapshot = carry.snapshot();
    if (!snapshot) return reload(false);
    // 交給重新載入之後會接手的那一個。新版本已經開始接手就直接交給它，不等 controllerchange：
    // 電腦忙的時候超過 FALLBACK_MS 才收到，交給舊版本的話，它在重新載入的途中就被換掉了
    const target = incoming && ["activating", "activated"].includes(incoming.state) ? incoming : navigator.serviceWorker.controller;
    try {
      if (!target) throw new Error("no service worker");
      await ask(target, { type: "hold", tray: snapshot });
      reload(true);
    } catch {
      finishing = false;
      setUpdating(false);
      setCarryFailed(true);
    }
  };

  const start = async (quiet: boolean) => {
    if (requested) return;
    requested = true;
    silent = quiet;
    if (!quiet) setUpdating(true);
    setTimeout(() => void finish(), FALLBACK_MS);
    // 按下時再查一次，提示出現之後可能又有更新的一版裝好了
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
    const next = reg?.waiting ?? (waiting?.state === "installed" ? waiting : null);
    incoming = next;
    if (next) next.postMessage("skipWaiting");
    else void finish();
  };

  // 換版本之後的第一次載入：拿回暫存區
  useEffect(() => {
    const { [UPDATED]: wasUpdated, [CARRIED]: carried, ...rest } = history.state ?? {};
    if (wasUpdated === undefined && carried === undefined) return;
    history.replaceState(Object.keys(rest).length ? rest : null, "");
    const controller = navigator.serviceWorker?.controller;
    if (!carried) return;
    const shown = wasUpdated ? "kept" : null;
    (controller ? ask<{ tray: TraySnapshot | null }>(controller, { type: "take" }) : Promise.reject(new Error("no controller")))
      .then(({ tray }) => {
        if (!tray) throw new Error("nothing held");
        carry.restore(tray);
        setUpdated(shown);
      })
      .catch(() => setUpdated("lost"));
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
      if (requested) void finish();
    };
    sw.addEventListener("controllerchange", onChange);
    return () => {
      alive = false;
      sw.removeEventListener("controllerchange", onChange);
    };
  }, []);

  // 沒有東西會遺失時，等分頁切到背景再換，讀者回來時已經是新版本
  useEffect(() => {
    if (!waiting || !idle) return;
    const check = () => {
      if (document.hidden) void start(true);
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [waiting, idle]);

  return {
    ready,
    // 沒有東西會遺失時不出現提示
    update: carryFailed ? () => reload(false) : waiting && !idle ? () => void start(false) : null,
    updating,
    carryFailed,
    updated,
    dismissUpdated: () => setUpdated(null),
  };
}

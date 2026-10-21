import { useEffect, useState } from "preact/hooks";
import type { TraySnapshot } from "../core/tray.ts";

// 註冊 service worker（src/sw/sw-template.js），回報離線是否可用、有沒有等著換上的新版本。
// 開發伺服器不註冊，免得改了程式卻一直拿到舊的。
//
// 換版本要重新載入頁面，暫存區只在記憶體裡，重新載入就沒了。所以：
// - 暫存區是空的、畫面上也沒有填到一半的東西（idle）時不出現提示。讀者還沒操作過這個頁面就直接換，
//   已經在操作的等分頁切到背景再換，換上之後都顯示「已換上新版本」
// - 瀏覽器只在整頁載入時檢查 sw.js，站內換頁不算。分頁切回前景時、開著的分頁每小時另外檢查一次
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

// 讀者按了「重新載入」（或沒有東西會遺失、分頁切到背景）才換版本
let requested = false;
// 讀者在這個頁面按過、打過字沒有。還沒有的話，換版本時畫面閃一下不會打斷任何事
let touched = false;
if (typeof window !== "undefined") {
  const touch = () => {
    touched = true;
    window.removeEventListener("pointerdown", touch, true);
    window.removeEventListener("keydown", touch, true);
  };
  window.addEventListener("pointerdown", touch, true);
  window.addEventListener("keydown", touch, true);
}
// 開著的分頁多久檢查一次新版本
const CHECK_MS = 60 * 60 * 1000;
let reloading = false;

// 等新版本接手的上限。等著的那一版已經被更新的一版取代、或瀏覽器沒有切換時等不到，
// 超過這個時間就交給目前的版本暫放、重新載入，按鈕不會停在那裡沒有反應
const SETTLE_MS = 8000;
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

// 等這個 service worker 接手完成（activated），或被更新的一版取代（redundant）
function settle(worker: ServiceWorker): Promise<void> {
  const done = () => worker.state === "activated" || worker.state === "redundant";
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      resolve();
    };
    const check = () => done() && finish();
    const timer = setTimeout(finish, SETTLE_MS);
    worker.addEventListener("statechange", check);
  });
}

// 讀者按了重新載入換新版本，暫存區已經交給新版本，離開前不必再確認（src/app.tsx 的 useKeepTray）
export const isReloading = () => reloading;

function reload(carried: boolean) {
  if (reloading) return;
  reloading = true;
  // 自動換上的也顯示「已換上新版本」。原本不顯示，讀者重新整理之後還是舊版、切出去再回來才換好，
  // 不知道中間發生了什麼（2026-10-22）
  history.replaceState({ ...(history.state ?? {}), [UPDATED]: true, [CARRIED]: carried }, "");
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

  // 新版本接手之後，把暫存區交給它暫放再重新載入。暫放失敗就停下來，讓讀者先下載。
  // 交給重新載入之後會接手的那一個：等新版本接手完成再交給它。不用固定的等待時間，
  // 電腦忙的時候新版本比較晚接手，交給舊版本的話，它在重新載入的途中就被換掉了。
  // 新版本沒有接手（被更新的一版取代、或時間到）時交給目前的版本，重新載入不會讓等著的版本接手
  const finish = async (next: ServiceWorker | null) => {
    if (next) await settle(next);
    const snapshot = carry.snapshot();
    if (!snapshot) return reload(false);
    const target = next?.state === "activated" ? next : navigator.serviceWorker.controller;
    try {
      if (!target) throw new Error("no service worker");
      await ask(target, { type: "hold", tray: snapshot });
      reload(true);
    } catch {
      setUpdating(false);
      setCarryFailed(true);
    }
  };

  const start = async (quiet: boolean) => {
    if (requested) return;
    requested = true;
    if (!quiet) setUpdating(true);
    // 按下時再查一次，提示出現之後可能又有更新的一版裝好了
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
    const next = reg?.waiting ?? (waiting?.state === "installed" ? waiting : null);
    next?.postMessage("skipWaiting");
    await finish(next);
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
    let registration: ServiceWorkerRegistration | null = null;
    // 檢查新版本。沒有網路時會失敗，下次再試
    const check = () => {
      if (!document.hidden) void registration?.update().catch(() => {});
    };
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        registration = reg;
        watch(reg);
        return sw.ready;
      })
      .then(() => alive && setReady(true))
      .catch(() => {});
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // 沒有東西會遺失時不出現提示。讀者還沒操作過就直接換，已經在操作的等分頁切到背景再換，回來時已經是新版本
  useEffect(() => {
    if (!waiting || !idle) return;
    const check = () => {
      if (document.hidden || !touched) void start(true);
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

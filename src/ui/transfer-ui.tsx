// 面對面傳送與遠端傳送共用的畫面：選要送出的檔案、檔案大小、傳送時不讓螢幕關掉。

import { useEffect, useRef, useState } from "preact/hooks";
import type { TrayFile, TrayState } from "../core/tray.ts";
import { t } from "../i18n/index.ts";
import { outputName } from "./output-name.ts";

export const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// 傳送的時候不讓螢幕關掉，手機鎖屏之後連線可能斷掉
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    void navigator.wakeLock.request("screen").then((l) => (alive ? (lock = l) : void l.release()), () => {});
    return () => {
      alive = false;
      void lock?.release();
    };
  }, [active]);
}

// 要送出的檔案：預設全選，打開工具之後才加入暫存區的檔案也勾上（seen 記著已經處理過的檔案）。
// 檔名預設跟下載一樣改成 gears 加編號，原本的檔名常帶著日期或人名。傳給自己的其他裝置時可以保留
export function useOutgoing(state: TrayState) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(state.files.map((f) => f.id)));
  const seen = useRef(new Set(state.files.map((f) => f.id)));
  useEffect(() => {
    const added = state.files.filter((f) => !seen.current.has(f.id)).map((f) => f.id);
    if (!added.length) return;
    for (const id of added) seen.current.add(id);
    setPicked((s) => new Set([...s, ...added]));
  }, [state.files]);
  const [keepNames, setKeepNames] = useState(false);
  const nameOf = (f: TrayFile) => (keepNames ? f.name : outputName(f, state.files.indexOf(f)));
  const files = state.files.filter((f) => picked.has(f.id));
  const toggle = (id: number) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return {
    files,
    outgoing: () => files.map((f) => ({ name: nameOf(f), blob: f.versions.at(-1)!.blob })),
    picker: (
      <>
        <fieldset class="choices">
          <legend>{t("nearby.pick")}</legend>
          {state.files.map((f) => (
            <label key={f.id} class="check">
              <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f.id)} />
              <span>
                {nameOf(f)}
                <small class="hint">{size(f.versions.at(-1)!.blob.size)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label class="check">
          <input type="checkbox" checked={keepNames} onChange={(e) => setKeepNames(e.currentTarget.checked)} data-testid="nearby-keep-names" />
          <span>
            {t("nearby.keepNames")}
            <small class="hint">{t("nearby.keepNamesNote")}</small>
          </span>
        </label>
      </>
    ),
  };
}

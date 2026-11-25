import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import type { TrayState } from "../core/tray.ts";
import { tray } from "../state.ts";

// 畫面畫好的當下就訂閱（useLayoutEffect）。原本用 useEffect，Preact 在畫面更新之後才由計時器執行它，
// 電腦忙的時候讀者已經選好檔案、暫存區有了變動，這個元件卻還沒訂閱，畫面一直停在空的暫存區。
// 訂閱之前狀態已經換過的話（畫面用的是換之前的那一份），補畫一次
export function useTray(): TrayState {
  const [, setTick] = useState(0);
  const state = tray.get();
  useLayoutEffect(() => {
    const update = () => setTick((n) => n + 1);
    const off = tray.subscribe(update);
    if (tray.get() !== state) update();
    return off;
  }, []);
  return state;
}

// 預覽用的 blob: 網址，元件卸下或檔案換掉時立刻收回。
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

// 寬螢幕：工作台分成左右兩欄的寬度，跟 styles.css 的 @media (min-width: 52rem) 同一個數字。
// 工具以外的頁面只在寬螢幕顯示左欄（src/ui/PageAside.tsx），已下載的模型的儲存空間依這個決定放在左欄
// 還是頁面本身，同一段文字只出現在一個地方
export const WIDE = "(min-width: 52rem)";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

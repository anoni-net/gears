import { useEffect, useState } from "preact/hooks";
import type { TrayState } from "../core/tray.ts";
import { tray } from "../state.ts";

export function useTray(): TrayState {
  const [, setTick] = useState(0);
  useEffect(() => tray.subscribe(() => setTick((n) => n + 1)), []);
  return tray.get();
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

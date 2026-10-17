import { useEffect, useState } from "preact/hooks";

// 正在進行、重新載入就會中斷的工作，例如轉逐字稿、自動尋找人臉、組 PDF、算雜湊值。
// 進行中不出現換版本的提示（src/app.tsx），讀者不會在工作途中按下重新載入，做完才出現

let count = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

// 在編輯畫面裡呼叫，active 是 true 的期間算進行中
export function useWorking(active: boolean) {
  useEffect(() => {
    if (!active) return;
    count++;
    emit();
    return () => {
      count--;
      emit();
    };
  }, [active]);
}

export function useAnyWorking(): boolean {
  const [working, setWorking] = useState(count > 0);
  useEffect(() => {
    const listener = () => setWorking(count > 0);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return working;
}

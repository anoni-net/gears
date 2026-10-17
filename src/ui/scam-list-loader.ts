import { useEffect, useState } from "preact/hooks";
import { type ScamList, parseScamList } from "../tools/url-check/scam-list.ts";

// 165 反詐騙的停止解析清單約 1.5 MB，打開工具時下載一次，整份留在這個分頁裡比對。
// 網址檢查與信件檢查共用同一份
let listPromise: Promise<ScamList | null> | null = null;
function loadScamList(): Promise<ScamList | null> {
  listPromise ??= fetch(`${import.meta.env.BASE_URL}data/165.txt`)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
    .then(parseScamList)
    .catch(() => null);
  return listPromise;
}

export function useScamList() {
  const [list, setList] = useState<ScamList | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadScamList().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

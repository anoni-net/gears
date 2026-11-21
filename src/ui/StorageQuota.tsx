import { useEffect, useState } from "preact/hooks";
import { getLocale, t } from "../i18n/index.ts";
import { PII_MB } from "../tools/redact/pii-model.ts";
import { PUNCT_MB } from "../tools/transcribe/punct.ts";

// 已下載的模型頁的「這個網站的儲存空間」：瀏覽器分給這個網站多少空間、用了多少，以及持久儲存的狀態。
// 模型存在一般的快取裡，空間不夠時瀏覽器可能自動清掉，下次要重新下載。申請持久儲存（navigator.storage.persist）
// 之後瀏覽器比較不會自動清掉。只在讀者按下按鈕時申請，不自動申請：Firefox 會跳出權限詢問，
// Chrome 與 Brave 依使用情況自行決定、不會詢問，Tor Browser 與私密瀏覽可能直接拒絕。
// 寬螢幕放在左欄（src/ui/PageAside.tsx），手機放在頁面本身（src/ui/StoragePage.tsx），同一時間只有一份

// 刪除模型之後通知這一塊重新讀用量
export const STORAGE_CHANGED = "gears:storage-changed";

type Result = "pending" | "granted" | "denied" | "failed";

// 已用與上限：超過 1 GB 的寫成 1.6 GB，其他寫成 MB
const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

const api = () => (typeof navigator !== "undefined" ? navigator.storage : undefined);

export function StorageQuota({ inAside }: { inAside: boolean }) {
  // undefined 是還在讀，null 是這個瀏覽器沒有這個 API。依 MDN，Safari 16.4 有 persisted()、還沒有 estimate()，各自偵測
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null | undefined>(undefined);
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const read = () => {
      const storage = api();
      if (typeof storage?.estimate === "function")
        storage.estimate().then(
          (e) => setUsage(typeof e.usage === "number" && typeof e.quota === "number" ? { usage: e.usage, quota: e.quota } : null),
          () => setUsage(null),
        );
      else setUsage(null);
      if (typeof storage?.persisted === "function")
        storage.persisted().then(
          (p) => setPersisted(p),
          () => setPersisted(null),
        );
      else setPersisted(null);
    };
    read();
    window.addEventListener(STORAGE_CHANGED, read);
    return () => window.removeEventListener(STORAGE_CHANGED, read);
  }, []);

  const canPersist = typeof api()?.persist === "function";
  const request = async () => {
    setResult("pending");
    try {
      const ok = await api()!.persist();
      setResult(ok ? "granted" : "denied");
      if (ok) setPersisted(true);
    } catch {
      setResult("failed");
    }
  };

  // 寬螢幕的左欄不用小標題：左欄在主內容之前，放 <h2> 會排在頁面的 <h1> 前面
  const Title = inAside ? "p" : "h2";
  const status = !canPersist ? "unsupported" : persisted ? (result === "granted" ? "granted" : "already") : null;

  return (
    <section class={inAside ? "storage-quota in-aside" : "storage-quota"} aria-labelledby="storage-quota-title" data-testid="storage-quota">
      <Title id="storage-quota-title" class={inAside ? "aside-label" : undefined}>
        {t("storage.quota.title")}
      </Title>
      {usage ? (
        <p data-testid="storage-usage">
          {t("storage.quota.usage", { used: size(usage.usage), quota: size(usage.quota) })}
          {/* 英文的句子之間空一格，中文不空 */}
          <span class="hint">
            {getLocale() === "en" ? " " : ""}
            {t("storage.quota.usageNote")}
          </span>
        </p>
      ) : null}
      {persisted === undefined ? null : status === "already" ? (
        <p data-testid="storage-persist-state">{t("storage.persist.already")}</p>
      ) : status === "unsupported" ? (
        <p data-testid="storage-persist-state">{t("storage.persist.unsupported")}</p>
      ) : status === "granted" ? null : (
        <>
          <p class={inAside ? "hint" : undefined}>{t("storage.persist.why", { punct: PUNCT_MB, pii: PII_MB })}</p>
          <div class="buttons">
            <button type="button" onClick={() => void request()} disabled={result === "pending"} data-testid="storage-persist">
              {t(result === "pending" ? "storage.persist.pending" : "storage.persist.button")}
            </button>
          </div>
          {/* 申請之前說明各家瀏覽器的做法。等待回覆時多半是 Firefox 跳出了詢問，改成請讀者在那裡選擇 */}
          {result === null || result === "pending" ? <p class="hint">{t(result === "pending" ? "storage.persist.waiting" : "storage.persist.browsers")}</p> : null}
        </>
      )}
      <p role="status" class="storage-persist-result" data-testid="storage-persist-status">
        {result === "granted" ? t("storage.persist.granted") : result === "denied" ? t("storage.persist.denied") : result === "failed" ? t("storage.persist.failed") : ""}
      </p>
    </section>
  );
}

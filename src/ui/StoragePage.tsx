import { useEffect, useState } from "preact/hooks";
import { type StorageKey, type StorageRow, formatSize, keyId, scanStorage } from "../core/storage.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { WIDE, useMedia } from "./hooks.ts";
import { IconCircle } from "./Icon.tsx";
import { STORAGE_CHANGED, StorageQuota } from "./StorageQuota.tsx";
import { PAGE_META } from "./tool-meta.ts";

// 已下載的模型：Gears 存在這個瀏覽器裡的模型與程式，一列一個用途，可以逐列刪除（#142，
// 分類在 src/core/storage.ts）。刪除之後下次用到時再下載。這個網站的儲存空間與持久儲存（StorageQuota）
// 寬螢幕放在左欄，手機放在這一頁的最下面

const BASE = import.meta.env.BASE_URL;

async function remove(rows: StorageRow[]) {
  for (const row of rows) for (const [name, request] of row.entries) await (await caches.open(name)).delete(request);
}

// 這一列的名稱與用在哪裡。設計原則頁的即時檢查也用這個名稱
export const nameOf = ({ group, model }: StorageKey) => (model ? tDynamic(`transcribe.model.${model}`) : tDynamic(`storage.item.${group}`));
const usedBy = ({ group }: StorageKey) => (group === "transcribe" || group === "speaker" || group === "vad" || group === "punct" ? t("tool.transcribe") : group === "faces" || group === "ocr" || group === "pii" ? t("tool.redact") : group === "c2pa" ? t("tool.verify") : group === "other" ? "" : tDynamic(`storage.used.${group}`));

export function StoragePage() {
  // undefined 是還在計算
  const [rows, setRows] = useState<StorageRow[] | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const wide = useMedia(WIDE);
  const load = () => scanStorage(BASE).then(setRows, () => setRows(null));
  useEffect(() => void load(), []);

  const del = async (targets: StorageRow[], done: string) => {
    setBusy(true);
    try {
      await remove(targets);
      setMessage(done);
    } catch {
      setMessage(t("storage.failed"));
    }
    setBusy(false);
    await load();
    window.dispatchEvent(new Event(STORAGE_CHANGED));
  };

  const total = rows?.reduce((n, r) => n + r.bytes, 0) ?? 0;

  return (
    <section class="storage" aria-labelledby="storage-title">
      <h1 id="storage-title" class="tool-title">
        <IconCircle name={PAGE_META.storage.icon} cat={PAGE_META.storage.cat} />
        {t("storage.title")}
      </h1>
      <p>{t("storage.intro")}</p>
      {rows === undefined ? (
        <p class="hint">{t("storage.loading")}</p>
      ) : rows === null ? (
        <p class="notice" data-testid="storage-unavailable">
          {t("storage.unavailable")}
        </p>
      ) : !rows.length ? (
        <p class="hint" data-testid="storage-empty">
          {t("storage.empty")}
        </p>
      ) : (
        <>
          <ul class="storage-list" data-testid="storage-list">
            {rows.map((row) => {
              const name = nameOf(row.key);
              const used = usedBy(row.key);
              return (
                <li key={keyId(row.key)}>
                  <span class="storage-name">
                    {name}
                    {used ? <small>{used}</small> : null}
                  </span>
                  <span class="storage-size">{formatSize(row.bytes)}</span>
                  <button type="button" disabled={busy} aria-label={t("storage.deleteItem", { name })} onClick={() => void del([row], t("storage.deleted", { name }))}>
                    {t("storage.delete")}
                  </button>
                </li>
              );
            })}
          </ul>
          <div class="storage-total">
            <p>{t("storage.total", { size: formatSize(total) })}</p>
            <button type="button" disabled={busy} onClick={() => void del(rows, t("storage.deletedAll"))}>
              {t("storage.deleteAll")}
            </button>
          </div>
        </>
      )}
      <p class="hint" role="status" data-testid="storage-status">
        {message}
      </p>
      {wide ? null : <StorageQuota inAside={false} />}
    </section>
  );
}

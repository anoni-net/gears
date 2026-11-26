import { useEffect, useState } from "preact/hooks";
import { toolsUsing } from "../core/model-catalog.ts";
import { type StorageKey, type StorageRow, catalogId, formatSize, keyId, modelNames, scanStorage } from "../core/storage.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
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
// 用在哪幾個工具：模型照 TOOL_MODELS，驗證內容憑證是查證，執行模型的程式這類共用的寫 storage.used.*
const usedBy = (key: StorageKey) => {
  const id = catalogId(key);
  if (id) return list(toolsUsing(id).map((tool) => tDynamic(`tool.${tool}`)));
  return key.group === "c2pa" ? t("tool.verify") : key.group === "other" ? "" : tDynamic(`storage.used.${key.group}`);
};

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
    <section aria-labelledby="storage-title">
      <h1 id="storage-title" class="tool-title">
        <IconCircle name={PAGE_META.storage.icon} cat={PAGE_META.storage.cat} />
        {t("storage.title")}
      </h1>
      <p>{t("storage.intro")}</p>
      {rows === undefined ? (
        <p class="hint">{t("storage.loading")}</p>
      ) : rows === null ? (
        <p class="callout" data-testid="storage-unavailable">
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
              // 用途下面一行寫模型的名稱與用在哪個工具，例如「YuNet · 遮蔽」
              const detail = [list(modelNames(row.key, row.entries.map(([, r]) => r.url))), usedBy(row.key)].filter(Boolean).join(" · ");
              return (
                <li key={keyId(row.key)}>
                  <span class="storage-name">
                    {name}
                    {detail ? <small>{detail}</small> : null}
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

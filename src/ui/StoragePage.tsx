import { useEffect, useState } from "preact/hooks";
import { STORAGE_CACHES, type StorageKey, classify, compareKeys, keyId } from "../core/storage.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { IconCircle } from "./Icon.tsx";
import { PAGE_META } from "./tool-meta.ts";

// 已下載的模型：Gears 存在這個瀏覽器裡的模型與程式，一列一個用途，可以逐列刪除（#142，
// 分類在 src/core/storage.ts）。刪除之後下次用到時再下載。

const BASE = import.meta.env.BASE_URL;

interface Row {
  key: StorageKey;
  bytes: number;
  entries: [cache: string, request: Request][];
}

// 超過 1 GB 的寫成 1.6 GB，1 MB 以下的寫成 KB
const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

// 讀三個快取，依用途分列。不能用 Cache API 時（私密瀏覽、Tor Browser）回傳 null
async function scan(): Promise<Row[] | null> {
  if (typeof caches === "undefined") return null;
  const names = await caches.keys().catch(() => null);
  if (!names) return null;
  const rows = new Map<string, Row>();
  for (const name of STORAGE_CACHES) {
    if (!names.includes(name)) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const key = classify(name, request.url, BASE);
      // 快取的內容存在磁碟上，blob() 不會把整個檔案讀進記憶體
      const bytes = (await (await cache.match(request))?.blob())?.size ?? 0;
      const row = rows.get(keyId(key)) ?? { key, bytes: 0, entries: [] };
      row.bytes += bytes;
      row.entries.push([name, request]);
      rows.set(keyId(key), row);
    }
  }
  return [...rows.values()].sort((a, b) => compareKeys(a.key, b.key));
}

async function remove(rows: Row[]) {
  for (const row of rows) for (const [name, request] of row.entries) await (await caches.open(name)).delete(request);
}

// 這一列的名稱與用在哪裡
const nameOf = ({ group, model }: StorageKey) => (model ? tDynamic(`transcribe.model.${model}`) : tDynamic(`storage.item.${group}`));
const usedBy = ({ group }: StorageKey) => (group === "transcribe" || group === "speaker" ? t("tool.transcribe") : group === "faces" || group === "ocr" ? t("tool.redact") : group === "c2pa" ? t("tool.verify") : group === "other" ? "" : tDynamic(`storage.used.${group}`));

export function StoragePage() {
  // undefined 是還在計算
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => scan().then(setRows, () => setRows(null));
  useEffect(() => void load(), []);

  const del = async (targets: Row[], done: string) => {
    setBusy(true);
    try {
      await remove(targets);
      setMessage(done);
    } catch {
      setMessage(t("storage.failed"));
    }
    setBusy(false);
    await load();
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
                  <span class="storage-size">{size(row.bytes)}</span>
                  <button type="button" disabled={busy} aria-label={t("storage.deleteItem", { name })} onClick={() => void del([row], t("storage.deleted", { name }))}>
                    {t("storage.delete")}
                  </button>
                </li>
              );
            })}
          </ul>
          <div class="storage-total">
            <p>{t("storage.total", { size: size(total) })}</p>
            <button type="button" disabled={busy} onClick={() => void del(rows, t("storage.deletedAll"))}>
              {t("storage.deleteAll")}
            </button>
          </div>
        </>
      )}
      <p class="hint" role="status" data-testid="storage-status">
        {message}
      </p>
    </section>
  );
}

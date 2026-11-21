import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { MODEL_CATALOG, catalogRange } from "../core/model-catalog.ts";
import { MODEL_GROUPS, RUNTIME_MB, type StorageRow, formatSize, scanStorage } from "../core/storage.ts";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { useDeviceSupport } from "./device-support.ts";
import { IconCircle } from "./Icon.tsx";
import { nameOf } from "./StoragePage.tsx";
import { PAGE_META } from "./tool-meta.ts";

// 設計原則（/gears/about/）：寫給不熟技術的讀者，說明 Gears 的兩層設計：瀏覽器裡就能完成的工具，
// 加上開源本機模型的加強（AGENTS.md「定位」、「設計原則頁」）。每一段用 Gears 裡實際的工具當例子。
//
// - 小標題的 id 是固定的：桌面的「了解更多」連到 #browser、#models（src/ui/DeskIntro.tsx），
//   寬螢幕左欄的本頁目錄也讀這些 h2、h3（src/ui/PageAside.tsx）
// - 模型表從 src/core/model-catalog.ts 產生，數字跟著各模型的設定，不在這裡或字串裡手寫
// - 即時檢查只在畫面上顯示，不送出：離線使用（src/ui/offline.ts，由 src/app.tsx 傳進來，不再註冊一次
//   service worker）、已下載的模型（src/core/storage.ts 的分類）、WebAssembly 與顯示卡（src/ui/device-support.ts）
// - 引用社群評測的數字不附連結：評測放在社群的工作區，還沒有公開
// - 跟隱私說明重複的內容只寫重點，連到那一頁

const BASE = import.meta.env.BASE_URL;

// 字串裡的 {link} 換成連結，其他變數照 t() 的做法
function withLink(text: string, link: ComponentChildren) {
  const [before, after] = text.split("{link}");
  return (
    <>
      {before}
      {link}
      {after}
    </>
  );
}

function PageLink({ id, hash, children }: { id: string; hash?: string; children: ComponentChildren }) {
  return (
    <a href={`${routeUrl(id)}${hash ? `#${hash}` : ""}`} onClick={(e) => onRouteClick(e, () => navigate(id, hash))}>
      {children}
    </a>
  );
}

function ModelTable() {
  return (
    <div class="about-table">
      <table data-testid="about-models">
        <caption>{t("about.models.caption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("about.models.col.name")}</th>
            <th scope="col">{t("about.models.col.use")}</th>
            <th scope="col">{t("about.models.col.license")}</th>
            <th scope="col">{t("about.models.col.size")}</th>
          </tr>
        </thead>
        <tbody>
          {MODEL_CATALOG.map((m) => (
            <tr key={m.id} data-model={m.id}>
              <th scope="row">
                <a href={m.source} target="_blank" rel="noopener noreferrer">
                  {m.name}
                </a>
              </th>
              <td>{tDynamic(`about.use.${m.id}`)}</td>
              <td class="about-license">
                <PageLink id="licenses" hash={`licenses-${m.licenses}`}>
                  {m.license}
                </PageLink>
              </td>
              <td class="about-size">{formatSize(m.bytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type OfflineState = "ready" | "pending" | "unsupported";

// 一項檢查：名稱、讀者看得懂的結果與一句說明
function StatusItem({ id, state, result, note }: { id: string; state: string; result: string; note?: ComponentChildren }) {
  return (
    <div data-testid={`about-status-${id}`} data-state={state}>
      <dt>{tDynamic(`about.status.${id}`)}</dt>
      <dd>
        <strong>{result}</strong>
        {note ? <span class="about-status-note">{note}</span> : null}
      </dd>
    </div>
  );
}

function Status({ offlineReady }: { offlineReady: boolean }) {
  const support = useDeviceSupport();
  // undefined 是還在檢查，null 是不能用 Cache API（私密瀏覽、Tor Browser）
  const [models, setModels] = useState<StorageRow[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    scanStorage(BASE)
      .then((rows) => rows && rows.filter((row) => MODEL_GROUPS.includes(row.key.group)))
      .catch(() => null)
      .then((rows) => alive && setModels(rows));
    return () => {
      alive = false;
    };
  }, []);

  // 沒有 service worker：Tor Browser、部分瀏覽器的私密瀏覽、不是安全的連線。有的話還沒就緒時分不出是還在存、
  // 還是這次沒有存成功，說明兩種都寫
  const offline: OfflineState = offlineReady ? "ready" : "serviceWorker" in navigator ? "pending" : "unsupported";
  const modelState = models === undefined ? "loading" : models === null ? "unavailable" : models.length ? "some" : "none";
  const gpuState = !support.wasm ? "noWasm" : support.gpu === "checking" ? "checking" : support.gpu;

  return (
    <dl class="about-status" data-testid="about-status">
      <StatusItem id="offline" state={offline} result={tDynamic(`about.status.offline.${offline}`)} note={tDynamic(`about.status.offline.${offline}.note`)} />
      <StatusItem
        id="models"
        state={modelState}
        result={modelState === "unavailable" ? t("storage.unavailable") : modelState === "some" ? t("about.status.models.some", { n: models!.length }) : tDynamic(`about.status.models.${modelState}`)}
        note={
          modelState === "some" ? (
            <>
              <ul data-testid="about-status-model-list">
                {models!.map((row) => (
                  <li key={row.key.model ? `${row.key.group}:${row.key.model}` : row.key.group}>{nameOf(row.key)}</li>
                ))}
              </ul>
              {withLink(t("about.status.models.manage"), <PageLink id="storage">{t("storage.title")}</PageLink>)}
            </>
          ) : modelState === "none" ? (
            t("about.status.models.none.note")
          ) : undefined
        }
      />
      <StatusItem id="wasm" state={support.wasm ? "yes" : "no"} result={t(support.wasm ? "about.status.wasm.yes" : "about.status.wasm.no")} note={t(support.wasm ? "about.status.wasm.yes.note" : "about.status.wasm.no.note")} />
      <StatusItem
        id="gpu"
        state={gpuState}
        result={tDynamic(`about.status.gpu.${gpuState}`)}
        note={
          gpuState === "checking" ? undefined : (
            <>
              {tDynamic(`about.status.gpu.${gpuState}.note`)}
              {getLocale() === "en" ? " " : ""}
              <PageLink id="bench">{t("desk.device.more")}</PageLink>
            </>
          )
        }
      />
    </dl>
  );
}

export function AboutPage({ offlineReady }: { offlineReady: boolean }) {
  const { min, max } = catalogRange();
  const more: [id: string, title: string][] = [
    ["privacy", t("privacy.title")],
    ["licenses", t("licenses.title")],
    ["storage", t("storage.title")],
    ["testing", t("testing.title")],
  ];
  return (
    <section class="about" aria-labelledby="about-title" data-testid="about">
      <h1 id="about-title" class="tool-title">
        <IconCircle name={PAGE_META.about.icon} cat={PAGE_META.about.cat} />
        {t("about.title")}
      </h1>
      <p class="about-lead">{t("about.intro")}</p>

      <section aria-labelledby="browser">
        <h2 id="browser">{t("about.browser.title")}</h2>
        <p>{t("about.browser.body")}</p>
        <h3 id="browser-server">{t("about.browser.server.title")}</h3>
        <p>{t("about.browser.server.body")}</p>
        <p>{withLink(t("about.browser.server.logs"), <PageLink id="privacy">{t("privacy.title")}</PageLink>)}</p>
        <h3 id="browser-check">{t("about.browser.check.title")}</h3>
        <ul>
          {[1, 2, 3].map((n) => (
            <li key={n}>{tDynamic(`about.browser.check.${n}`)}</li>
          ))}
        </ul>
        <h3 id="browser-tray">{t("about.browser.tray.title")}</h3>
        <p>{t("about.browser.tray.body")}</p>
      </section>

      <section aria-labelledby="models">
        <h2 id="models">{t("about.models.title")}</h2>
        <p>{t("about.models.body")}</p>
        <h3 id="models-local">{t("about.models.local.title")}</h3>
        <p>{t("about.models.local.body")}</p>
        <h3 id="models-open">{t("about.models.open.title")}</h3>
        <p>{t("about.models.open.intro")}</p>
        <ul>
          {[1, 2, 3].map((n) => (
            <li key={n}>{tDynamic(`about.models.open.${n}`)}</li>
          ))}
        </ul>
        <p>{t("about.models.open.host")}</p>
        <h3 id="models-list">{t("about.models.list.title")}</h3>
        <p>{t("about.models.list.intro")}</p>
        <ModelTable />
        <p class="hint">{t("about.models.list.runtime", { size: `${RUNTIME_MB} MB` })}</p>
      </section>

      <section aria-labelledby="confirm">
        <h2 id="confirm">{t("about.confirm.title")}</h2>
        <p>{t("about.confirm.body")}</p>
        <ul>
          {[1, 2, 3].map((n) => (
            <li key={n}>{tDynamic(`about.confirm.${n}`)}</li>
          ))}
        </ul>
        <p>{t("about.confirm.why")}</p>
        <p>{t("about.confirm.why2")}</p>
        <h3 id="confirm-fallback">{t("about.confirm.fallback.title")}</h3>
        <p>{t("about.confirm.fallback.body")}</p>
        <h3 id="confirm-none">{t("about.confirm.none.title")}</h3>
        <p>{t("about.confirm.none.body")}</p>
        <h3 id="confirm-never">{t("about.confirm.never.title")}</h3>
        <p>{t("about.confirm.never.body")}</p>
      </section>

      <section aria-labelledby="tradeoffs">
        <h2 id="tradeoffs">{t("about.tradeoffs.title")}</h2>
        <h3 id="tradeoffs-download">{t("about.tradeoffs.download.title")}</h3>
        <p data-testid="about-range">{t("about.tradeoffs.download.body", { min: formatSize(min.bytes), max: formatSize(max.bytes), minName: min.name, maxName: max.name })}</p>
        <p>{withLink(t("about.tradeoffs.download.manage"), <PageLink id="storage">{t("storage.title")}</PageLink>)}</p>
        <h3 id="tradeoffs-device">{t("about.tradeoffs.device.title")}</h3>
        <p>{t("about.tradeoffs.device.body")}</p>
        <p>{withLink(t("about.tradeoffs.device.invite"), <PageLink id="testing">{t("testing.title")}</PageLink>)}</p>
        <h3 id="tradeoffs-criteria">{t("about.tradeoffs.criteria.title")}</h3>
        <p>{t("about.tradeoffs.criteria.body")}</p>
      </section>

      <section aria-labelledby="status">
        <h2 id="status">{t("about.status.title")}</h2>
        <p>{t("about.status.intro")}</p>
        <Status offlineReady={offlineReady} />
      </section>

      <section aria-labelledby="more">
        <h2 id="more">{t("about.more.title")}</h2>
        <ul class="about-more" data-testid="about-more">
          {more.map(([id, title]) => (
            <li key={id}>
              <PageLink id={id}>{title}</PageLink>
              {t("about.more.sep")}
              {tDynamic(`about.more.${id}`)}
            </li>
          ))}
          <li>
            <a href="https://github.com/anoni-net/gears" target="_blank" rel="noopener noreferrer">
              {t("about.more.source.title")}
            </a>
            {t("about.more.sep")}
            {t("about.more.source")}
          </li>
        </ul>
      </section>

      <p class="hint">{t("about.updated")}</p>
    </section>
  );
}

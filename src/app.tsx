import type { ComponentType } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { COMMUNITY_URL, IS_ONION } from "./site.ts";
import { LOCALES, getLocale, t, tDynamic } from "./i18n/index.ts";
import { navigate, onRouteClick, routeUrl, switchLocale, useRoute } from "./router.ts";
import { tray } from "./state.ts";
import { createTools, editorTools, fileTools } from "./tools/index.ts";
import { Desktop, type Task } from "./ui/Desktop.tsx";
import { FileView } from "./ui/FileView.tsx";
import { Licenses } from "./ui/Licenses.tsx";
import { NOT_FOUND, pageIds } from "./pages.ts";
import { ToolIntro } from "./ui/ToolIntro.tsx";
import { LocaleHint } from "./ui/LocaleHint.tsx";
import { TrayList } from "./ui/TrayList.tsx";
import { isReloading, useOffline } from "./ui/offline.ts";
import { useAnyWorking } from "./ui/working.ts";
import { useTray } from "./ui/hooks.ts";
import { CreateToolView } from "./ui/registry.tsx";
import { Icon, IconCircle } from "./ui/Icon.tsx";
import { TOOL_META, groupOf } from "./ui/tool-meta.ts";
import { browserDeclines, optedOut, setOptedOut, track, trackView } from "./ui/analytics.ts";
import { COMMIT, COMMIT_URL, VERSION } from "./version.ts";
import { FeedbackPage } from "./ui/FeedbackPage.tsx";
import { NotFoundPage } from "./ui/NotFoundPage.tsx";
import { PrivacyPage } from "./ui/PrivacyPage.tsx";
import { RemoteServerPage } from "./ui/RemoteServerPage.tsx";
import { SampleLink, SamplesPage } from "./ui/SamplesPage.tsx";
import { StoragePage } from "./ui/StoragePage.tsx";
import { type FileSample, makeSampleFile } from "./ui/samples.ts";

const isCreateTool = (id: string) => createTools.some((tool) => tool.id === id);
// 處理整個暫存區的工具，加入檔案時留在原畫面（CreateTool 的 tray）
const usesTray = (id: string) => createTools.some((tool) => tool.id === id && tool.tray);
const isPage = (id: string) => pageIds.includes(id) || id === NOT_FOUND;

// 裝置量測（實驗頁）用到時才載入，桌面維持輕量
function BenchView() {
  const [View, setView] = useState<ComponentType | null>(null);
  useEffect(() => {
    void import("./ui/BenchPage.tsx").then((m) => setView(() => m.BenchPage));
  }, []);
  return View ? <View /> : null;
}
const isFileTool = (id: string) => [...fileTools, ...editorTools].some((tool) => tool.id === id);

// 整個頁面都能拖放，不必瞄準某一塊區域。
function useDropAnywhere(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      onFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}

// 清空暫存區會一次放掉所有檔案，沒有辦法復原，跟「回到桌面」並排又很容易按錯。
// 第一次按下只是確認，按鈕變成紅底的「再按一次清空」，4 秒內再按一次才清空。
// 確認的文字跟原本差不多長，手機上不會把語系擠到下一列
function ClearButton() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      class={armed ? "site-header__clear armed" : "site-header__clear"}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        tray.clear();
      }}
      onBlur={() => setArmed(false)}
    >
      <Icon name="delete-sweep-outline" />
      <span aria-live="polite">{armed ? t("app.clearConfirm") : t("app.clear")}</span>
    </button>
  );
}

// 頁尾的使用統計說明與開關。選擇存在這個瀏覽器裡。瀏覽器要求不追蹤時什麼都不送，
// 只說明不記錄，不必提到 Umami
// 使用統計的說明，後面接隱私說明的連結（記錄什麼、送到哪裡的完整說明在那一頁）。
// 隱私說明放在 data-testid="analytics" 外面，那一段的文字與按鈕維持原樣
function AnalyticsChoice() {
  const [off, setOff] = useState(optedOut);
  // 英文的句子之間空一格，中文不空
  const sep = getLocale() === "en" ? " " : "";
  const privacy = (
    <a href={routeUrl("privacy")} onClick={(e) => onRouteClick(e, () => navigate("privacy"))} data-testid="privacy-link">
      {t("app.footer.privacy")}
    </a>
  );
  if (IS_ONION || browserDeclines())
    return (
      <p>
        <span data-testid="analytics">{t(IS_ONION ? "app.analytics.onion" : "app.analytics.declined")}</span>
        {sep}
        {privacy}
      </p>
    );
  return (
    <p>
      <span data-testid="analytics">
        {t("app.analytics.note")}
        {sep}
        {off ? `${t("app.analytics.stopped")}${sep}` : null}
        <button
          type="button"
          class="link"
          onClick={() => {
            setOptedOut(!off);
            setOff(!off);
          }}
        >
          {t(off ? "app.analytics.resume" : "app.analytics.stop")}
        </button>
      </span>
      {" · "}
      {privacy}
    </p>
  );
}

// 暫存區只在記憶體裡，重新整理就清空。手機上很容易一滑就觸發下拉重新整理，所以暫存區有檔案時：
// - 頁面加上 overscroll-behavior-y: none（html.has-files），Android 的 Chrome、Firefox 與 iOS 16 以後的
//   Safari 不會觸發下拉重新整理
// - iOS 的 Safari 下拉重新整理是瀏覽器自己的手勢，CSS 不一定擋得住：頁面已經在最上面、手指往下拉時
//   直接攔下 touchmove。往上捲、兩指縮放、在自己能捲動的區塊裡捲動都不受影響
// - 重新整理或關閉分頁之前請瀏覽器先確認（beforeunload）。iOS 的 Safari 不支援，靠上兩項
// 讀者按重新載入換新版本時暫存區會帶過去，不必確認
function useKeepTray(hasFiles: boolean) {
  useEffect(() => {
    document.documentElement.classList.toggle("has-files", hasFiles);
    if (!hasFiles) return;
    const confirm = (e: BeforeUnloadEvent) => {
      if (isReloading()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    let startY: number | null = null;
    const start = (e: TouchEvent) => {
      startY = e.touches.length === 1 && window.scrollY <= 0 ? e.touches[0]!.clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (startY === null || e.touches.length !== 1 || window.scrollY > 0) return;
      if (e.touches[0]!.clientY <= startY) return;
      // 手指所在的區塊自己還能往上捲，就讓它捲
      for (let el = e.target as Element | null; el && el !== document.body; el = el.parentElement) {
        if (el.scrollTop > 0) return;
      }
      if (e.cancelable) e.preventDefault();
    };
    window.addEventListener("beforeunload", confirm);
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    return () => {
      window.removeEventListener("beforeunload", confirm);
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
    };
  }, [hasFiles]);
}

export function App() {
  const state = useTray();
  useKeepTray(state.files.length > 0);
  const route = useRoute();
  // 建議與回饋記下讀者從哪個工具過來（src/feedback.ts），在建議與回饋裡換語系時不變
  const from = useRef("");
  if (route !== "feedback") from.current = route;
  const input = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<string>();

  // 加入檔案之後顯示那個檔案。正在用從空白開始的工具時，先回到桌面。
  // 處理整個暫存區的工具（查證、面對面傳送）例外：加入的檔案正是要給它用的，留在原畫面
  // 從哪一組的任務或工具加入，記在檔案上，檔案畫面的工具列表把那一組排在前面（src/ui/shelf.ts）。
  // 工具自己產生的檔案不記
  const addFiles = async (files: File[], origin: string | null = null) => {
    if (!files.length) return;
    await tray.add(files, origin, origin ? undefined : groupOf(route));
    if ((isCreateTool(route) && !usesTray(route)) || isPage(route)) navigate("");
  };
  const dragging = useDropAnywhere((files) => void addFiles(files));

  useEffect(() => {
    document.title = route ? tDynamic(`meta.${route}.title`) : t("meta.home.title");
    trackView();
  }, [route, getLocale()]);

  const pick = () => input.current?.click();
  const onChange = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    void addFiles([...(el.files ?? [])]);
    el.value = "";
  };

  const home = (e?: Event) => {
    e?.preventDefault();
    tray.select(null);
    setPreset(undefined);
    navigate("");
  };

  const selectFile = (id: number) => {
    tray.select(id);
    if (isCreateTool(route) || isPage(route)) navigate("");
  };

  const openTool = (id: string, value?: string) => {
    tray.select(null);
    setPreset(value);
    navigate(id);
  };

  // 範例頁的檔案：產生之後標成範例放進暫存區，用對應的工具打開。查證讀整個暫存區，
  // 信件檢查用預設值 tray:<檔案 id> 讀，處理檔案的工具在它的網址選好檔案就直接打開
  const openSample = async (sample: FileSample) => {
    const file = await makeSampleFile(sample);
    if (isCreateTool(sample.tool)) {
      await tray.add([file], null, groupOf(sample.tool), true);
      if (usesTray(sample.tool)) {
        tray.select(null);
        setPreset(undefined);
        navigate(sample.tool);
      } else {
        openTool(sample.tool, `tray:${tray.get().selected}`);
      }
    } else {
      setPreset(undefined);
      navigate(sample.tool);
      await tray.add([file], null, groupOf(sample.tool), true);
    }
  };
  const showSamples = (tool: string) => openTool("samples", tool);

  const onTask = (task: Task) => {
    track("task", { task: task.id });
    tray.select(null);
    setPreset(task.preset);
    navigate(task.tool);
    // 選檔案的對話框要在點擊的當下打開，瀏覽器才允許
    if (task.pick) pick();
  };

  const selectedIndex = state.files.findIndex((f) => f.id === state.selected);
  const selected = state.files[selectedIndex];
  const atHome = !route && !selected;

  // 暫存區是空的，畫面上也沒有填到一半的東西（桌面、授權頁、還沒選檔案的工具說明），換版本不會遺失任何東西。
  // 從空白開始的工具有讀者輸入的文字或產生的金鑰，不算
  const idle = !state.files.length && !state.busy && (!route || route === "licenses" || isFileTool(route));
  const offline = useOffline(idle, tray);
  // 轉逐字稿這類工作進行中不出現換版本的提示，重新載入會中斷它，做完才出現
  const working = useAnyWorking() || state.busy;

  // 頁面的 <h1>（#164）：工具與工具以外的頁面用自己的標題（.tool-title），桌面與檔案畫面沒有自己的標題，
  // 用頁首的網站名稱，找不到的頁面也是。原本每一頁的 <h1> 都是網站名稱，搜尋引擎分不出各頁在講什麼
  let view;
  let titled = true;
  if (isCreateTool(route)) {
    view = (
      <section class="create" aria-labelledby="create-title">
        <h1 id="create-title" class="tool-title">
          <IconCircle name={TOOL_META[route]!.icon} cat={TOOL_META[route]!.cat} />
          {tDynamic(`tool.${route}`)}
        </h1>
        <p class="hint">{tDynamic(`tool.${route}.desc`)}</p>
        <SampleLink tool={route} onOpen={showSamples} />
        <CreateToolView
          key={`${route}-${preset ?? ""}`}
          id={route}
          preset={preset}
          onCreate={(file) => void addFiles([file], route)}
          onOpenTool={openTool}
        />
      </section>
    );
  } else if (route === "licenses") {
    view = <Licenses />;
  } else if (route === "bench") {
    view = <BenchView />;
  } else if (route === NOT_FOUND) {
    // 找不到的頁面不收錄，標題留給網站名稱，讀者知道還在 Gears 裡
    titled = false;
    view = <NotFoundPage />;
  } else if (route === "feedback") {
    view = <FeedbackPage from={from.current} />;
  } else if (route === "remote-server") {
    view = <RemoteServerPage />;
  } else if (route === "privacy") {
    view = <PrivacyPage />;
  } else if (route === "storage") {
    view = <StoragePage />;
  } else if (route === "samples") {
    view = <SamplesPage focus={preset} onOpenFile={openSample} onOpenQr={(id) => openTool("qr-read", `sample:${id}`)} />;
  } else if (selected) {
    titled = false;
    view = <FileView key={selected.id} file={selected} others={state.files} index={selectedIndex} busy={state.busy} preferred={route} onOpenTool={openTool} />;
  } else if (isFileTool(route)) {
    view = <ToolIntro id={route} onPick={pick} onSamples={showSamples} />;
  } else {
    titled = false;
    view = <Desktop onTask={onTask} />;
  }
  const SiteTitle = titled ? "p" : "h1";

  return (
    <div class={dragging ? "app dragging" : "app"}>
      {/* 頁首的排版跟新聞導讀一致：anoni.net 字標、分隔線、產品名稱，右邊是回到桌面與清空暫存區。
          語系切換只放在頁尾：工具不常換語系，手機上的第二列也少一個可能按錯的按鈕。
          底色維持工作台的淡藍，字標用 tonal 版，深色模式換成白色版（品牌素材頁的用法）。
          名稱寫「檔案工作台」（英文版 File Workbench），右上角的標記寫產品名稱 Gears（app.badge） */}
      <header class="site-header">
        <div class="frame site-header__inner">
          <SiteTitle class="site-header__title">
            <a class="site-header__home" href={routeUrl("")} onClick={home}>
              <picture>
                <source srcset={`${import.meta.env.BASE_URL}logo-wordmark-white.svg`} media="(prefers-color-scheme: dark)" />
                <img class="site-header__logo" src={`${import.meta.env.BASE_URL}logo-wordmark-tonal.svg`} alt="anoni.net" width="116" height="28" />
              </picture>
              <span class="site-header__product">
                {t("app.title")}
                <span class="site-header__badge" lang="en">
                  {t("app.badge")}
                </span>
              </span>
            </a>
          </SiteTitle>
          <div class="site-header__actions">
            {!atHome ? (
              <button type="button" class="site-header__home-button" onClick={home}>
                <Icon name="home-outline" />
                {t("app.home")}
              </button>
            ) : null}
            {state.files.length ? <ClearButton /> : null}
          </div>
        </div>
      </header>

      <input ref={input} type="file" multiple hidden onChange={onChange} data-testid="file-input" />

      {/* 外層的 frame 負責左右留白，提示框本身才有邊框，窄螢幕上不會貼齊螢幕邊緣 */}
      {offline.update && (!working || offline.updating) ? (
        <div class="frame">
          <div class="update-bar" role="status">
            <span>{t(offline.carryFailed ? "app.updateCarryFailed" : offline.idle ? "app.updateIdle" : "app.update")}</span>
            <button type="button" class="primary" onClick={offline.update} disabled={offline.updating}>
              {t(offline.updating ? "app.updating" : "app.updateReload")}
            </button>
          </div>
        </div>
      ) : offline.updated ? (
        <div class="frame">
          <div class="update-bar" role="status">
            <span>{t(offline.updated === "kept" ? "app.updatedKept" : offline.updated === "lost" ? "app.updatedLost" : "app.updated", { version: VERSION })}</span>
            <button type="button" onClick={offline.dismissUpdated}>
              {t("app.updatedClose")}
            </button>
          </div>
        </div>
      ) : null}
      <LocaleHint />

      {/* 授權、建議與回饋這類工具以外的頁面不顯示暫存區，改成單欄。檔案仍在記憶體裡，回到桌面就看得到 */}
      <main class={isPage(route) ? "workbench solo frame" : "workbench frame"}>
        {isPage(route) ? null : (
          <TrayList
            files={state.files}
            selected={state.selected}
            onSelect={selectFile}
            onPick={pick}
            busy={state.busy}
            failed={state.failed}
            compact={!atHome && !state.files.length}
            keep={groupOf(route) === "check" || state.files.every((f) => f.intent === "check")}
          />
        )}
        <div class="view">{view}</div>
      </main>

      {/* 寬螢幕分左右兩欄，說明在左，連結與語系在右並靠右對齊。手機上照原本的順序排下來 */}
      <footer class="frame">
        <div class="footer-notes">
          <p>{t("app.memoryNote")}</p>
          {offline.ready ? <p data-testid="offline-ready">{t("app.offlineReady")}</p> : null}
          <AnalyticsChoice />
        </div>
        <div class="footer-links">
          <p>
            {/* 連結只留三個，手機上維持一行：隱私說明接在使用統計的說明後面，原始碼放在版本號那一行 */}
            <a href={COMMUNITY_URL}>{t("app.footer.community")}</a>{" "}
            {/* 窄螢幕換行時「· 連結」整組換到下一行，分隔點不會留在行尾 */}
            <span class="footer-item">
              {"· "}
              {/* 站內的頁面一般的點擊不重新載入，避免清空暫存區（onRouteClick） */}
              <a href={routeUrl("feedback")} onClick={(e) => onRouteClick(e, () => navigate("feedback"))} data-testid="feedback-link">
                {t("app.footer.feedback")}
              </a>
            </span>{" "}
            <span class="footer-item">
              {"· "}
              <a href={routeUrl("licenses")} onClick={(e) => onRouteClick(e, () => navigate("licenses"))}>
                {t("app.footer.licenses")}
              </a>
            </span>
          </p>
          <nav class="languages" aria-label={t("app.language")}>
            {/* 不懂中文的讀者也認得出這裡是切換語言 */}
            <Icon name="translate" />
            {LOCALES.map((l) => (
              <button
                key={l.id}
                type="button"
                class="link"
                lang={l.lang}
                aria-current={l.id === getLocale() ? "true" : undefined}
                onClick={() => switchLocale(l.id)}
              >
                {l.label}
              </button>
            ))}
          </nav>
          {/* 版本號：讀者回報問題時照這裡抄，commit 連到原始碼的那一次修改 */}
          <p class="version">
            <span data-testid="version">
              {t("app.version", { version: VERSION })}{" "}
              <a href={COMMIT_URL}>
                <code>{COMMIT}</code>
              </a>
            </span>
            {" · "}
            <a href="https://github.com/anoni-net/gears">{t("app.footer.source")}</a>
          </p>
        </div>
      </footer>

      {dragging ? (
        <div class="drop-overlay" aria-hidden="true">
          {t("desk.dragging")}
        </div>
      ) : null}
    </div>
  );
}

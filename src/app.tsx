import { useEffect, useRef, useState } from "preact/hooks";
import { LOCALES, getLocale, t, tDynamic } from "./i18n/index.ts";
import { navigate, routeUrl, switchLocale, useRoute } from "./router.ts";
import { tray } from "./state.ts";
import { createTools, editorTools, fileTools } from "./tools/index.ts";
import { Desktop, type Task } from "./ui/Desktop.tsx";
import { FileView } from "./ui/FileView.tsx";
import { Licenses } from "./ui/Licenses.tsx";
import { ToolIntro } from "./ui/ToolIntro.tsx";
import { TrayList } from "./ui/TrayList.tsx";
import { useOffline } from "./ui/offline.ts";
import { useTray } from "./ui/hooks.ts";
import { CreateToolView } from "./ui/registry.tsx";
import { Icon, IconCircle } from "./ui/Icon.tsx";
import { TOOL_META } from "./ui/tool-meta.ts";
import { browserDeclines, optedOut, setOptedOut, track, trackView } from "./ui/analytics.ts";

const isCreateTool = (id: string) => createTools.some((tool) => tool.id === id);
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

// 頁尾的使用統計說明與開關。選擇存在這個瀏覽器裡，瀏覽器要求不追蹤時直接說明不記錄
function AnalyticsChoice() {
  const [off, setOff] = useState(optedOut);
  // 英文的句子之間空一格，中文不空
  const sep = getLocale() === "en" ? " " : "";
  if (browserDeclines())
    return (
      <p data-testid="analytics">
        {t("app.analytics.note")}
        {sep}
        {t("app.analytics.declined")}
      </p>
    );
  return (
    <p data-testid="analytics">
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
    </p>
  );
}

export function App() {
  const state = useTray();
  const route = useRoute();
  const input = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<string>();

  // 加入檔案之後顯示那個檔案。正在用從空白開始的工具時，先回到桌面。
  // 查證例外：它整理的就是暫存區裡的檔案，加入之後留在查證的畫面
  const addFiles = async (files: File[], origin: string | null = null) => {
    if (!files.length) return;
    await tray.add(files, origin);
    if ((isCreateTool(route) && route !== "verify") || route === "licenses") navigate("");
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
    if (isCreateTool(route) || route === "licenses") navigate("");
  };

  const openTool = (id: string, value?: string) => {
    tray.select(null);
    setPreset(value);
    navigate(id);
  };

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

  let view;
  if (isCreateTool(route)) {
    view = (
      <section class="create" aria-labelledby="create-title">
        <h2 id="create-title" class="tool-title">
          <IconCircle name={TOOL_META[route]!.icon} cat={TOOL_META[route]!.cat} />
          {tDynamic(`tool.${route}`)}
        </h2>
        <p class="hint">{tDynamic(`tool.${route}.desc`)}</p>
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
  } else if (selected) {
    view = <FileView key={selected.id} file={selected} index={selectedIndex} busy={state.busy} preferred={route} onOpenTool={openTool} />;
  } else if (isFileTool(route)) {
    view = <ToolIntro id={route} onPick={pick} />;
  } else {
    view = <Desktop onTask={onTask} />;
  }

  return (
    <div class={dragging ? "app dragging" : "app"}>
      {/* 頁首的排版跟新聞導讀一致：anoni.net 字標、分隔線、產品名稱，右邊是回到桌面與清空暫存區。
          語系切換只放在頁尾：工具不常換語系，手機上的第二列也少一個可能按錯的按鈕。
          底色維持工作台的淡藍，字標用 tonal 版，深色模式換成白色版（品牌素材頁的用法）。
          名稱寫「檔案工作台」（英文版 File Workbench），右上角的標記寫產品名稱 Gears（app.badge）。
          標語放在桌面最上面 */}
      <header class="site-header">
        <div class="frame site-header__inner">
          <h1 class="site-header__title">
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
          </h1>
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
      {offline.update ? (
        <div class="frame">
          <div class="update-bar" role="status">
            <span>{t(offline.carryFailed ? "app.updateCarryFailed" : "app.update")}</span>
            <button type="button" class="primary" onClick={offline.update} disabled={offline.updating}>
              {t(offline.updating ? "app.updating" : "app.updateReload")}
            </button>
          </div>
        </div>
      ) : offline.updated ? (
        <div class="frame">
          <div class="update-bar" role="status">
            <span>{t(offline.updated === "kept" ? "app.updatedKept" : offline.updated === "lost" ? "app.updatedLost" : "app.updated")}</span>
            <button type="button" onClick={offline.dismissUpdated}>
              {t("app.updatedClose")}
            </button>
          </div>
        </div>
      ) : null}

      <main class="workbench frame">
        <TrayList
          files={state.files}
          selected={state.selected}
          onSelect={selectFile}
          onPick={pick}
          busy={state.busy}
          failed={state.failed}
          compact={!atHome && !state.files.length}
        />
        <div class="view">{view}</div>
      </main>

      <footer class="frame">
        <p>{t("app.memoryNote")}</p>
        {offline.ready ? <p data-testid="offline-ready">{t("app.offlineReady")}</p> : null}
        <AnalyticsChoice />
        <p>
          <a href="https://anoni.net/">{t("app.footer.community")}</a>
          {" · "}
          <a href="https://github.com/anoni-net/gears">{t("app.footer.source")}</a>
          {" · "}
          {/* 站內的頁面不用一般的連結，避免重新載入、清空暫存區 */}
          <button type="button" class="link" onClick={() => navigate("licenses")}>
            {t("app.footer.licenses")}
          </button>
        </p>
        <nav class="languages" aria-label={t("app.language")}>
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
      </footer>

      {dragging ? (
        <div class="drop-overlay" aria-hidden="true">
          {t("desk.dragging")}
        </div>
      ) : null}
    </div>
  );
}

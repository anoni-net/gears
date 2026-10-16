import { useEffect, useRef, useState } from "preact/hooks";
import { LOCALES, getLocale, t, tDynamic } from "./i18n/index.ts";
import { navigate, routeUrl, switchLocale, useRoute } from "./router.ts";
import { tray } from "./state.ts";
import { createTools, editorTools, fileTools } from "./tools/index.ts";
import { Desktop, type Task } from "./ui/Desktop.tsx";
import { FileView } from "./ui/FileView.tsx";
import { ToolIntro } from "./ui/ToolIntro.tsx";
import { TrayList } from "./ui/TrayList.tsx";
import { useOffline } from "./ui/offline.ts";
import { useTray } from "./ui/hooks.ts";
import { CreateToolView } from "./ui/registry.tsx";
import { IconCircle } from "./ui/Icon.tsx";
import { TOOL_META } from "./ui/tool-meta.ts";

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

export function App() {
  const state = useTray();
  const route = useRoute();
  const input = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<string>();
  const offline = useOffline();

  // 加入檔案之後顯示那個檔案。正在用從空白開始的工具時，先回到桌面。
  // 查證例外：它整理的就是暫存區裡的檔案，加入之後留在查證的畫面
  const addFiles = async (files: File[], origin: string | null = null) => {
    if (!files.length) return;
    await tray.add(files, origin);
    if (isCreateTool(route) && route !== "verify") navigate("");
  };
  const dragging = useDropAnywhere((files) => void addFiles(files));

  useEffect(() => {
    document.title = route ? tDynamic(`meta.${route}.title`) : t("meta.home.title");
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
    if (isCreateTool(route)) navigate("");
  };

  const openTool = (id: string, value?: string) => {
    tray.select(null);
    setPreset(value);
    navigate(id);
  };

  const onTask = (task: Task) => {
    tray.select(null);
    setPreset(task.preset);
    navigate(task.tool);
    // 選檔案的對話框要在點擊的當下打開，瀏覽器才允許
    if (task.pick) pick();
  };

  const selectedIndex = state.files.findIndex((f) => f.id === state.selected);
  const selected = state.files[selectedIndex];
  const atHome = !route && !selected;

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
  } else if (selected) {
    view = <FileView key={selected.id} file={selected} index={selectedIndex} busy={state.busy} preferred={route} onOpenTool={openTool} />;
  } else if (isFileTool(route)) {
    view = <ToolIntro id={route} onPick={pick} />;
  } else {
    view = <Desktop onTask={onTask} />;
  }

  return (
    <div class={dragging ? "app dragging" : "app"}>
      {/* 頁首的排版跟新聞導讀一致：anoni.net 字標、分隔線、產品名稱，右邊是操作與語系切換。
          底色維持工作台的淡藍，字標用 tonal 版，深色模式換成白色版（品牌素材頁的用法）。
          產品名稱是 Gears，華語版後面接「隱私工作台」，英文版就叫 Gears（app.title）。
          名稱右上角掛著 Beta，正式上線之後再拿掉。標語放在桌面最上面 */}
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
                <span class="site-header__beta" lang="en">
                  Beta
                </span>
              </span>
            </a>
          </h1>
          <div class="site-header__actions">
            {!atHome ? (
              <button type="button" onClick={home}>
                {t("app.home")}
              </button>
            ) : null}
            {state.files.length ? (
              <button type="button" onClick={() => tray.clear()}>
                {t("app.clear")}
              </button>
            ) : null}
            <nav class="site-header__langs" aria-label={t("app.language")}>
              {LOCALES.filter((l) => l.id !== getLocale()).map((l) => (
                <button key={l.id} type="button" lang={l.lang} aria-label={l.label} onClick={() => switchLocale(l.id)}>
                  {l.short}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <input ref={input} type="file" multiple hidden onChange={onChange} data-testid="file-input" />

      {offline.update ? (
        <div class="update-bar frame" role="status">
          <span>{t("app.update")}</span>
          <button type="button" class="primary" onClick={offline.update} disabled={offline.updating}>
            {t(offline.updating ? "app.updating" : "app.updateReload")}
          </button>
        </div>
      ) : offline.updated ? (
        <div class="update-bar frame" role="status">
          <span>{t("app.updated")}</span>
          <button type="button" onClick={offline.dismissUpdated}>
            {t("app.updatedClose")}
          </button>
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
        <p>
          <a href="https://anoni.net/">{t("app.footer.community")}</a>
          {" · "}
          <a href="https://github.com/anoni-net/gears">{t("app.footer.source")}</a>
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

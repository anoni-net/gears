import { useEffect, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "./i18n/index.ts";
import { navigate, routeUrl, useRoute } from "./router.ts";
import { tray } from "./state.ts";
import { createTools, fileTools } from "./tools/index.ts";
import { Desktop, type Task } from "./ui/Desktop.tsx";
import { FileView } from "./ui/FileView.tsx";
import { ToolIntro } from "./ui/ToolIntro.tsx";
import { TrayList } from "./ui/TrayList.tsx";
import { useTray } from "./ui/hooks.ts";
import { CreateToolView } from "./ui/registry.tsx";

const isCreateTool = (id: string) => createTools.some((tool) => tool.id === id);
const isFileTool = (id: string) => fileTools.some((tool) => tool.id === id);

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

  // 加入檔案之後顯示那個檔案。正在用從空白開始的工具時，先回到桌面
  const addFiles = async (files: File[], origin: string | null = null) => {
    if (!files.length) return;
    await tray.add(files, origin);
    if (isCreateTool(route)) navigate("");
  };
  const dragging = useDropAnywhere((files) => void addFiles(files));

  useEffect(() => {
    document.title = route ? tDynamic(`meta.${route}.title`) : t("meta.home.title");
  }, [route]);

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
        <h2 id="create-title">{tDynamic(`tool.${route}`)}</h2>
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
      <header>
        <div>
          <h1>
            <a href={routeUrl("")} onClick={home}>
              {t("app.title")}
            </a>
          </h1>
          <p>{t("app.tagline")}</p>
        </div>
        <div class="header-actions">
          {!atHome ? (
            <button type="button" onClick={home}>
              {t("app.home")}
            </button>
          ) : null}
          {state.files.length ? (
            <button type="button" class="danger" onClick={() => tray.clear()}>
              {t("app.clear")}
            </button>
          ) : null}
        </div>
      </header>

      <input ref={input} type="file" multiple hidden onChange={onChange} data-testid="file-input" />

      <main class="workbench">
        <TrayList
          files={state.files}
          selected={state.selected}
          onSelect={selectFile}
          onPick={pick}
          compact={!atHome && !state.files.length}
        />
        <div class="view">{view}</div>
      </main>

      <footer>
        <p>{t("app.memoryNote")}</p>
        <p>
          <a href="https://anoni.net/">{t("app.footer.community")}</a>
          {" · "}
          <a href="https://github.com/anoni-net/gears">{t("app.footer.source")}</a>
        </p>
      </footer>

      {dragging ? (
        <div class="drop-overlay" aria-hidden="true">
          {t("desk.dragging")}
        </div>
      ) : null}
    </div>
  );
}

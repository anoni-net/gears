import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "./i18n/index.ts";
import { tray } from "./state.ts";
import { FileView } from "./ui/FileView.tsx";
import { StartPage } from "./ui/StartPage.tsx";
import { TrayList } from "./ui/TrayList.tsx";
import { useTray } from "./ui/hooks.ts";

export function App() {
  const state = useTray();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // 整個頁面都能拖放，不必瞄準某一塊區域。
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
      void tray.add([...(e.dataTransfer?.files ?? [])]);
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

  const pick = () => input.current?.click();
  const onChange = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    void tray.add([...(el.files ?? [])]);
    el.value = "";
  };

  const selectedIndex = state.files.findIndex((f) => f.id === state.selected);
  const selected = state.files[selectedIndex];

  return (
    <div class={dragging ? "app dragging" : "app"}>
      <header>
        <div>
          <h1>{t("app.title")}</h1>
          <p>{t("app.tagline")}</p>
        </div>
        {state.files.length ? (
          <div class="header-actions">
            <button type="button" onClick={pick}>
              {t("app.addFiles")}
            </button>
            <button type="button" class="danger" onClick={() => tray.clear()}>
              {t("app.clear")}
            </button>
          </div>
        ) : null}
      </header>

      <input ref={input} type="file" multiple hidden onChange={onChange} data-testid="file-input" />

      <main>
        {state.files.length ? (
          <div class="workbench">
            <TrayList files={state.files} selected={state.selected} />
            {selected ? <FileView key={selected.id} file={selected} index={selectedIndex} busy={state.busy} /> : null}
          </div>
        ) : (
          <StartPage onPick={pick} />
        )}
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
          {t("start.dragging")}
        </div>
      ) : null}
    </div>
  );
}

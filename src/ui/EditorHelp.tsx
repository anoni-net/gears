import type { ComponentChildren } from "preact";
import { t } from "../i18n/index.ts";
import { WIDE, useMedia } from "./hooks.ts";

// 編輯畫面第一段之後的說明（AGENTS.md「設計語言」的骨架）：寬螢幕照樣攤開，手機上收進「說明」，
// 要操作的圖片出現在第一個畫面裡。原本遮蔽在手機上要捲到 1.1 個畫面才看得到圖片
export function EditorHelp({ children }: { children: ComponentChildren }) {
  const wide = useMedia(WIDE);
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!items.length) return null;
  if (wide) return <>{items}</>;
  return (
    <details class="editor-help">
      <summary>{t("editor.help")}</summary>
      {items}
    </details>
  );
}

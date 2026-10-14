import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";

// 複製到剪貼簿。navigator.clipboard 只在 HTTPS 下能用，失敗時請讀者自行選取。
export function CopyButton({ text, label, primary = true }: { text: string; label?: string; primary?: boolean }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => setState("idle"), [text]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
  };
  return (
    <>
      <button type="button" class={primary ? "primary" : ""} onClick={copy} disabled={!text}>
        {state === "done" ? t("copy.done") : (label ?? t("copy.copy"))}
      </button>
      {state === "failed" ? (
        <span class="hint" role="status">
          {t("copy.failed")}
        </span>
      ) : null}
    </>
  );
}

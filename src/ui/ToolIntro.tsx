import { t, tDynamic } from "../i18n/index.ts";
import { IconCircle } from "./Icon.tsx";
import { TOOL_META } from "./tool-meta.ts";

// 處理檔案的工具還沒有選檔案時的畫面
export function ToolIntro({ id, onPick }: { id: string; onPick(): void }) {
  return (
    <section class="intro" aria-labelledby="intro-title">
      <h2 id="intro-title" class="tool-title">
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        {tDynamic(`tool.${id}`)}
      </h2>
      <p>{tDynamic(`tool.${id}.desc`)}</p>
      <p>
        <button type="button" class="primary" onClick={onPick}>
          {t("intro.pick")}
        </button>
      </p>
      <p class="hint">{t("intro.orTray")}</p>
    </section>
  );
}

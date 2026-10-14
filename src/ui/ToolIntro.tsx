import { t, tDynamic } from "../i18n/index.ts";

// 處理檔案的工具還沒有選檔案時的畫面
export function ToolIntro({ id, onPick }: { id: string; onPick(): void }) {
  return (
    <section class="intro" aria-labelledby="intro-title">
      <h2 id="intro-title">{tDynamic(`tool.${id}`)}</h2>
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

import { t, tDynamic } from "../i18n/index.ts";
import { IconCircle } from "./Icon.tsx";
import { SampleLink } from "./SamplesPage.tsx";
import { TOOL_META } from "./tool-meta.ts";

// 使用方式的步驟數，每個工具三步：選檔案、在工具裡做什麼、拿到什麼（howto.<工具 id>.<n>）
export const HOWTO_STEPS = [1, 2, 3] as const;

// 處理檔案的工具還沒有選檔案時的畫面。從搜尋引擎或分享的連結進來的讀者先看到這裡，
// 所以除了一句說明，另外寫出使用方式。在瀏覽器裡處理寫在暫存區的說明，這裡不重複
export function ToolIntro({ id, onPick, onSamples }: { id: string; onPick(): void; onSamples(tool: string): void }) {
  return (
    <section class="intro" aria-labelledby="intro-title">
      <h1 id="intro-title" class="tool-title">
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        {tDynamic(`tool.${id}`)}
      </h1>
      <p>{tDynamic(`tool.${id}.desc`)}</p>
      <h3 class="intro-howto">{t("intro.howto")}</h3>
      <ol class="intro-steps">
        {HOWTO_STEPS.map((n) => (
          <li key={n}>{tDynamic(`howto.${id}.${n}`)}</li>
        ))}
      </ol>
      <p>
        <button type="button" class="primary" onClick={onPick}>
          {t("intro.pick")}
        </button>
      </p>
      <p class="hint">{t("intro.orTray")}</p>
      <SampleLink tool={id} onOpen={onSamples} />
    </section>
  );
}

import { t, tDynamic } from "../i18n/index.ts";
import { IconCircle } from "./Icon.tsx";
import { SampleLink } from "./SamplesPage.tsx";
import { TOOL_META } from "./tool-meta.ts";

// 使用方式的步驟數，每個工具三步（howto.<工具 id>.<n>）
export const HOWTO_STEPS = [1, 2, 3] as const;

// 工具頁的開頭（AGENTS.md「設計語言」的骨架前兩塊）：圖示與工具名稱、一句說明、範例連結、三步的使用方式。
// 處理檔案的工具與從空白開始的工具共用，讀者換一個工具，起點都在同一個位置
export function ToolHeader({ id, titleId, onSamples }: { id: string; titleId: string; onSamples(tool: string): void }) {
  return (
    <>
      <h1 id={titleId} class="tool-title">
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        {tDynamic(`tool.${id}`)}
      </h1>
      <p class="tool-desc">{tDynamic(`tool.${id}.desc`)}</p>
      <SampleLink tool={id} onOpen={onSamples} />
      <div class="tool-howto">
        <h2>{t("intro.howto")}</h2>
        <ol>
          {HOWTO_STEPS.map((n) => (
            <li key={n}>{tDynamic(`howto.${id}.${n}`)}</li>
          ))}
        </ol>
      </div>
    </>
  );
}

// 處理檔案的工具還沒有選檔案時的畫面。從桌面、搜尋引擎或分享的連結進來的讀者都先看到這裡，按下「選擇檔案」
// 才打開系統的選檔案視窗（src/ui/tasks.ts）。在瀏覽器裡處理寫在暫存區的說明，這裡不重複
export function ToolIntro({ id, onPick, onSamples }: { id: string; onPick(): void; onSamples(tool: string): void }) {
  return (
    <section class="intro" aria-labelledby="intro-title">
      <ToolHeader id={id} titleId="intro-title" onSamples={onSamples} />
      <p>
        <button type="button" class="primary" onClick={onPick}>
          {t("intro.pick")}
        </button>
      </p>
      <p class="hint">{t("intro.orTray")}</p>
    </section>
  );
}

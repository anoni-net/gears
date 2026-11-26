import { MODEL_CATALOG, TOOL_MODELS } from "../core/model-catalog.ts";
import { formatSize } from "../core/storage.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { routeUrl } from "../router.ts";

// 工具頁最下面的「用到的開源模型」（AGENTS.md「設計語言」骨架的第五塊）：標了開源本機模型的工具列出用到的模型、
// 在這個工具裡做什麼、授權與第一次的下載量，最後連到已下載的模型，讀者可以在那裡看占多少空間、刪除。
// 模型與數字從 src/core/model-catalog.ts 讀（TOOL_MODELS、MODEL_CATALOG），不在這裡手寫。
// 連結都開新分頁：寫作習慣檢查貼上的文字、還沒下載的逐字稿換頁之後就不見了
export function ToolModels({ id }: { id: string }) {
  const ids = TOOL_MODELS[id];
  if (!ids) return null;
  const models = ids.map((m) => MODEL_CATALOG.find((c) => c.id === m)!);
  return (
    <section class="tool-models" aria-labelledby={`tool-models-${id}`} data-testid="tool-models">
      <h2 id={`tool-models-${id}`}>{t("toolmodels.title")}</h2>
      <p>{t("toolmodels.intro")}</p>
      <ul>
        {models.map((m) => (
          <li key={m.id} data-model={m.id}>
            <a href={m.source} target="_blank" rel="noopener noreferrer">
              {m.name}
            </a>
            <span>{tDynamic(`toolmodels.use.${m.id}`)}</span>
            <small>
              <a href={`${routeUrl("licenses")}#licenses-${m.licenses}`} target="_blank" rel="noopener">
                {m.license}
              </a>
              {" · "}
              {t("toolmodels.size", { size: formatSize(m.bytes) })}
            </small>
          </li>
        ))}
      </ul>
      <p>
        <a href={routeUrl("storage")} target="_blank" rel="noopener" data-testid="tool-models-storage">
          {t("toolmodels.manage")}
        </a>
        {t("toolmodels.manageNote")}
      </p>
    </section>
  );
}

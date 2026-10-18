import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { Icon, IconCircle } from "./Icon.tsx";
import { PAGE_META, TOOL_GROUPS, TOOL_META, USER_PAGES } from "./tool-meta.ts";
import { TAGS, TAG_ORDER, type TagId } from "./tool-tags.ts";
import { TASKS, type Task } from "./tasks.ts";

export type { Task };

interface Props {
  onTask(task: Task): void;
}

// 卡片上的圖示標籤（src/ui/tool-tags.ts）。圖示帶著這個工具的補充說明，讀螢幕軟體唸按鈕名稱時唸得到，
// 滑鼠移上去也看得到。手機上沒有提示，所以圖示的意思另外寫在桌面最下方的圖示說明
function ToolTags({ id }: { id: string }) {
  const tags = TOOL_META[id]!.tags;
  if (!tags?.length) return null;
  return (
    <span class="tool-tags">
      {tags.map((tag) => {
        const label = tDynamic(`tag.${tag}.${id}`);
        return (
          <span key={tag} class={`tool-tag tag-${tag}`} role="img" aria-label={label} title={label}>
            <Icon name={TAGS[tag].icon} />
          </span>
        );
      })}
    </span>
  );
}

function ToolCard({ id }: { id: string }) {
  return (
    <li>
      <button type="button" class="card" onClick={() => navigate(id)}>
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        <span class="card-text">
          <strong>
            {tDynamic(`tool.${id}`)}
            <ToolTags id={id} />
          </strong>
          <span>{tDynamic(`tool.${id}.desc`)}</span>
        </span>
      </button>
    </li>
  );
}

// 桌面：任務捷徑，加上依讀者的目的分成三組的工具，最後是使用者區。暫存區在旁邊一直看得到。
export function Desktop({ onTask }: Props) {
  // 圖示說明只列出有工具用到的標籤
  const used = TAG_ORDER.filter((tag) => Object.values(TOOL_META).some((meta) => meta.tags?.includes(tag)));
  return (
    <div class="desktop">
      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title">{t("desk.tasks")}</h2>
        <ul class="cards">
          {TASKS.map((task) => (
            <li key={task.id}>
              <button type="button" class="card task" onClick={() => onTask(task)}>
                <IconCircle name={TOOL_META[task.tool]!.icon} cat={TOOL_META[task.tool]!.cat} />
                <span class="card-text">
                  <strong>{tDynamic(`task.${task.id}`)}</strong>
                  <span>{tDynamic(`task.${task.id}.desc`)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tools-title">
        <h2 id="tools-title">{t("desk.tools")}</h2>
        {used.length ? (
          <p class="hint">
            {t("desk.tags.pointer")}
            <a href="#tag-legend">{t("desk.tags.title")}</a>
            {t("desk.tags.pointerEnd")}
          </p>
        ) : null}
        {TOOL_GROUPS.map((group) => (
          <div class="tool-group" key={group.id}>
            <h3>{tDynamic(`desk.group.${group.id}`)}</h3>
            <p class="hint">{tDynamic(`desk.group.${group.id}.desc`)}</p>
            <ul class="cards">
              {group.tools.map((id) => (
                <ToolCard key={id} id={id} />
              ))}
            </ul>
          </div>
        ))}
        <div class="tool-group">
          <h3>{t("desk.group.user")}</h3>
          <p class="hint">{t("desk.group.user.desc")}</p>
          <ul class="cards">
            {USER_PAGES.map((id) => (
              <li key={id}>
                <button type="button" class="card" onClick={() => navigate(id)}>
                  <IconCircle name={PAGE_META[id].icon} cat={PAGE_META[id].cat} />
                  <span class="card-text">
                    <strong>{tDynamic(`${id}.title`)}</strong>
                    <span>{tDynamic(`${id}.desc`)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {used.length ? (
        <section id="tag-legend" class="tag-legend" aria-labelledby="tag-legend-title">
          <h2 id="tag-legend-title">{t("desk.tags.title")}</h2>
          <dl data-testid="tag-legend">
            {used.map((tag: TagId) => (
              <div key={tag}>
                <dt>
                  <span class={`tool-tag tag-${tag}`} aria-hidden="true">
                    <Icon name={TAGS[tag].icon} />
                  </span>
                  {tDynamic(`tag.${tag}`)}
                </dt>
                <dd>{tDynamic(`tag.${tag}.desc`)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

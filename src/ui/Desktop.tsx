import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { Icon, IconCircle } from "./Icon.tsx";
import { PAGE_META, TOOL_GROUPS, TOOL_META, USER_PAGES, groupOf } from "./tool-meta.ts";
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

// 工具卡只放圖示、名稱與標籤，第一次來的讀者從同一組的常見情況認識工具。
// 說明放在 title，滑鼠移上去看得到，讀螢幕軟體也會唸
function ToolCard({ id }: { id: string }) {
  return (
    <li>
      <button type="button" class="card" title={tDynamic(`tool.${id}.desc`)} onClick={() => navigate(id)}>
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        <span class="card-text">
          <strong>
            {tDynamic(`tool.${id}`)}
            <ToolTags id={id} />
          </strong>
        </span>
      </button>
    </li>
  );
}

function TaskCard({ task, onTask }: { task: Task; onTask(task: Task): void }) {
  return (
    <li>
      <button type="button" class="card task" onClick={() => onTask(task)}>
        <IconCircle name={TOOL_META[task.tool]!.icon} cat={TOOL_META[task.tool]!.cat} />
        <span class="card-text">
          <strong>{tDynamic(`task.${task.id}`)}</strong>
          <span>{tDynamic(`task.${task.id}.desc`)}</span>
        </span>
      </button>
    </li>
  );
}

// 桌面：依讀者的目的分成三組，每組先放常見的情況，再列出這一組的全部工具，最後是使用者區。
// 最上面的三個入口跳到各組，手機上三組相隔好幾個畫面。暫存區在旁邊一直看得到
export function Desktop({ onTask }: Props) {
  // 圖示說明只列出有工具用到的標籤
  const used = TAG_ORDER.filter((tag) => Object.values(TOOL_META).some((meta) => meta.tags?.includes(tag)));
  return (
    <div class="desktop">
      <nav class="desk-jump" aria-label={t("desk.jump")}>
        <ul>
          {TOOL_GROUPS.map((group) => (
            <li key={group.id}>
              <a href={`#group-${group.id}`}>
                <strong>{tDynamic(`desk.group.${group.id}`)}</strong>
                <span>{tDynamic(`desk.group.${group.id}.desc`)}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {used.length ? (
        <p class="hint">
          {t("desk.tags.pointer")}
          <a href="#tag-legend">{t("desk.tags.title")}</a>
          {t("desk.tags.pointerEnd")}
        </p>
      ) : null}

      {TOOL_GROUPS.map((group) => {
        const tasks = TASKS.filter((task) => groupOf(task.tool) === group.id);
        return (
          <section class="tool-group" key={group.id} id={`group-${group.id}`} aria-labelledby={`group-${group.id}-title`}>
            <h2 id={`group-${group.id}-title`}>{tDynamic(`desk.group.${group.id}`)}</h2>
            <p class="hint">{tDynamic(`desk.group.${group.id}.desc`)}</p>
            <h3>{t("desk.tasks")}</h3>
            {/* 寬螢幕一列放得下三張，四張的組排成兩欄，最後一列才不會只剩一張 */}
            <ul class={tasks.length % 2 === 0 ? "cards pairs" : "cards"}>
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} onTask={onTask} />
              ))}
            </ul>
            <h3>{t("desk.groupTools")}</h3>
            <ul class="cards compact">
              {group.tools.map((id) => (
                <ToolCard key={id} id={id} />
              ))}
            </ul>
          </section>
        );
      })}

      <section class="tool-group" aria-labelledby="user-title">
        <h2 id="user-title">{t("desk.group.user")}</h2>
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

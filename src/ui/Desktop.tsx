import { t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
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

// 點工具時的動作：在 src/ui/tasks.ts 有一筆的照它打開（處理檔案的工具直接請讀者選檔案，使用統計記成 task），
// 沒有的就打開工具頁
const taskOf = (id: string) => TASKS.find((task) => task.tool === id);

// 每一列是連到工具網址的連結（#164），原本是按鈕，搜尋引擎從桌面找不到任何工具頁
function ToolRow({ id, onTask }: { id: string; onTask(task: Task): void }) {
  const task = taskOf(id);
  return (
    <li>
      <a
        class="button tool-row"
        href={routeUrl(id)}
        title={tDynamic(`tool.${id}.desc`)}
        onClick={(e) => onRouteClick(e, () => (task ? onTask(task) : navigate(id)))}
      >
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        <span class="tool-row-text">
          <strong>
            {tDynamic(`tool.${id}`)}
            <ToolTags id={id} />
          </strong>
          <span class="tool-row-when">{tDynamic(`desk.when.${id}`)}</span>
        </span>
      </a>
    </li>
  );
}

// 桌面：依讀者的目的分成三組的工具，每個工具一列，名稱下面一行寫讀者會遇到的情況。
// 2026-10-19 以前上面另有 12 張「常見的情況」卡片，其中 11 張跟下面的工具卡打開同一個工具，
// 首頁有 36 張卡片、手機要捲 8 個畫面。情況改寫進每個工具的那一行（desk.when.*），
// 點了照情況打開（taskOf）。範例、建議與回饋與圖示說明收在最下面一行。暫存區在旁邊一直看得到
export function Desktop({ onTask }: Props) {
  // 圖示說明只列出有工具用到的標籤
  const used = TAG_ORDER.filter((tag) => Object.values(TOOL_META).some((meta) => meta.tags?.includes(tag)));
  return (
    <div class="desktop">
      {TOOL_GROUPS.map((group) => (
        <section class="tool-group" key={group.id} aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`}>{tDynamic(`desk.group.${group.id}`)}</h2>
          <p class="hint">{tDynamic(`desk.group.${group.id}.desc`)}</p>
          <ul class="tool-rows">
            {group.tools.map((id) => (
              <ToolRow key={id} id={id} onTask={onTask} />
            ))}
          </ul>
        </section>
      ))}

      <div class="desk-more">
        <ul class="desk-user" aria-label={t("desk.group.user")}>
          {USER_PAGES.map((id) => (
            <li key={id}>
              <a href={routeUrl(id)} onClick={(e) => onRouteClick(e, () => navigate(id))}>
                <Icon name={PAGE_META[id].icon} />
                {tDynamic(PAGE_META[id].label ?? `${id}.title`)}
              </a>
            </li>
          ))}
        </ul>
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
    </div>
  );
}

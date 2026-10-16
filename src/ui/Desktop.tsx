import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { IconCircle } from "./Icon.tsx";
import { TOOL_GROUPS, TOOL_META } from "./tool-meta.ts";
import { TASKS, type Task } from "./tasks.ts";

export type { Task };

interface Props {
  onTask(task: Task): void;
}

function ToolCard({ id }: { id: string }) {
  return (
    <li>
      <button type="button" class="card" onClick={() => navigate(id)}>
        <IconCircle name={TOOL_META[id]!.icon} cat={TOOL_META[id]!.cat} />
        <span class="card-text">
          <strong>{tDynamic(`tool.${id}`)}</strong>
          <span>{tDynamic(`tool.${id}.desc`)}</span>
        </span>
      </button>
    </li>
  );
}

// 桌面：任務捷徑，加上依讀者的目的分成三組的工具。暫存區在旁邊一直看得到。
export function Desktop({ onTask }: Props) {
  return (
    <div class="desktop">
      <p class="tagline">{t("app.tagline")}</p>
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
      </section>
    </div>
  );
}

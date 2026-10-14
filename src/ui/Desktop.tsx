import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { createTools, editorTools, fileTools } from "../tools/index.ts";

export interface Task {
  id: "photo" | "redact" | "wifi";
  tool: string;
  preset?: string;
  pick?: boolean; // 處理檔案的任務，點了直接請讀者選檔案
}

// 給新手的任務捷徑，每個任務對應一個工具。之後的多步驟流程（例如交給記者前）
// 也放在這裡。
export const TASKS: Task[] = [
  { id: "photo", tool: "strip-metadata", pick: true },
  { id: "redact", tool: "redact", pick: true },
  { id: "wifi", tool: "qrcode", preset: "wifi" },
];

interface Props {
  onTask(task: Task): void;
}

function ToolCard({ id }: { id: string }) {
  return (
    <li>
      <button type="button" class="card" onClick={() => navigate(id)}>
        <strong>{tDynamic(`tool.${id}`)}</strong>
        <span>{tDynamic(`tool.${id}.desc`)}</span>
      </button>
    </li>
  );
}

// 桌面：全部的工具分兩組，加上任務捷徑。暫存區在旁邊一直看得到。
export function Desktop({ onTask }: Props) {
  return (
    <div class="desktop">
      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title">{t("desk.tasks")}</h2>
        <ul class="cards">
          {TASKS.map((task) => (
            <li key={task.id}>
              <button type="button" class="card task" onClick={() => onTask(task)}>
                <strong>{tDynamic(`task.${task.id}`)}</strong>
                <span>{tDynamic(`task.${task.id}.desc`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tools-title">
        <h2 id="tools-title">{t("desk.tools")}</h2>
        <h3>{t("desk.group.file")}</h3>
        <ul class="cards">
          {[...fileTools, ...editorTools].map((tool) => (
            <ToolCard key={tool.id} id={tool.id} />
          ))}
        </ul>
        <h3>{t("desk.group.create")}</h3>
        <ul class="cards">
          {createTools.map((tool) => (
            <ToolCard key={tool.id} id={tool.id} />
          ))}
        </ul>
        <h3>{t("desk.soon")}</h3>
        <ul class="soon">
          <li>{t("desk.soon.encrypt")}</li>
        </ul>
      </section>
    </div>
  );
}

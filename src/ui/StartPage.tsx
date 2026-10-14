import { t } from "../i18n/index.ts";

interface Props {
  onPick: () => void;
}

// 起始頁用任務分類，新手想的是自己要做什麼，不會知道該用哪個工具。
export function StartPage({ onPick }: Props) {
  return (
    <div class="start">
      <section class="drop" aria-labelledby="drop-title">
        <p id="drop-title">
          {t("start.drop")}{" "}
          <button type="button" class="primary" onClick={onPick}>
            {t("start.pick")}
          </button>
        </p>
        <p class="hint">{t("start.dropHint")}</p>
      </section>

      <section aria-labelledby="tasks-title">
        <h2 id="tasks-title">{t("start.tasks")}</h2>
        <ul class="tasks">
          <li>
            <button type="button" class="task" onClick={onPick}>
              <strong>{t("start.task.photo")}</strong>
              <span>{t("start.task.photo.desc")}</span>
            </button>
          </li>
        </ul>
        <h3>{t("start.soon")}</h3>
        <ul class="soon">
          <li>{t("start.soon.redact")}</li>
          <li>{t("start.soon.encrypt")}</li>
          <li>{t("start.soon.url")}</li>
        </ul>
      </section>
    </div>
  );
}

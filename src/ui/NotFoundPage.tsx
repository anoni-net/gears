import { t } from "../i18n/index.ts";
import { navigate } from "../router.ts";

// 網址打錯時的頁面（src/pages.ts 的 NOT_FOUND）。原本落到 nginx 預設的 404，讀者看到的是英文的
// 「404 Not Found」，不知道還在不在 Gears（2026-10-19 的使用回饋）
export function NotFoundPage() {
  return (
    <section class="not-found" aria-labelledby="not-found-title">
      <h2 id="not-found-title">{t("notFound.title")}</h2>
      <p>{t("notFound.body")}</p>
      <p>
        <button type="button" class="primary" onClick={() => navigate("")}>
          {t("app.home")}
        </button>
      </p>
    </section>
  );
}

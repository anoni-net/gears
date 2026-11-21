import { list, t } from "../i18n/index.ts";

// 停用的主要按鈕旁邊寫出還缺什麼（AGENTS.md「設計語言」的動作）。items 是還沒填的欄位名稱，空的時候不顯示
export function Missing({ items }: { items: (string | false | null | undefined)[] }) {
  const missing = items.filter((item): item is string => !!item);
  if (!missing.length) return null;
  return (
    <p class="missing" data-testid="missing">
      {t("common.missing", { list: list(missing) })}
    </p>
  );
}

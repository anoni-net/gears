import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";

// 隱私說明（/gears/privacy/）：Gears 會連到哪裡、誰可得知什麼、保存什麼，包括社群的伺服器留下的存取紀錄。
// 內容要跟程式與伺服器實際做的事一致，改了下面這些地方時一起改三個語系的 privacy.*：
// - 頁面能連線的對象：vite.config.ts 的 CSP（使用統計 src/ui/analytics.ts、表單 src/feedback.ts、
//   模型下載 src/core/models.ts 與 src/tools/*/models.json）
// - 存取紀錄：m6 的 nginx（/etc/nginx/conf.d/anoninet.conf），anoni.net、form.anoni.net、aa.anoni.net、
//   assets.anoni.net 都記 IP，每天輪替、保留 52 份（/etc/logrotate.d/nginx）。轉送服務不記（tools/nginx-gears.conf）
// - 留在裝置上的資料：service worker 的快取（src/sw/sw-template.js）、localStorage 只有使用統計的開關
const SECTIONS = [
  ["local", 4],
  ["visit", 4],
  ["onion", 3],
  ["analytics", 4],
  ["forms", 3],
  ["models", 4],
  ["remote", 2],
  ["device", 3],
  ["contact", 3],
] as const;

export function PrivacyPage() {
  return (
    <section class="privacy" aria-labelledby="privacy-title" data-testid="privacy">
      <h2 id="privacy-title" class="tool-title">
        {t("privacy.title")}
      </h2>
      <p>{t("privacy.intro")}</p>
      {SECTIONS.map(([id, count]) => (
        <section key={id} aria-labelledby={`privacy-${id}`}>
          <h3 id={`privacy-${id}`}>{tDynamic(`privacy.${id}.title`)}</h3>
          <ul>
            {Array.from({ length: count }, (_, i) => (
              <li key={i}>{tDynamic(`privacy.${id}.${i + 1}`)}</li>
            ))}
          </ul>
        </section>
      ))}
      <p class="hint">{t("privacy.updated")}</p>
      <div class="buttons">
        <button type="button" onClick={() => navigate("remote-server")}>
          {t("privacy.toRemote")}
        </button>
        <button type="button" onClick={() => navigate("storage")}>
          {t("privacy.toStorage")}
        </button>
        <button type="button" onClick={() => navigate("feedback")}>
          {t("privacy.toFeedback")}
        </button>
      </div>
    </section>
  );
}

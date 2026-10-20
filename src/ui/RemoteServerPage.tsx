import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";

// 遠端傳送的政策頁（anoni-net/gears#104）：經過哪些伺服器、看得到與保存什麼、加密的方式、使用的限制、
// 濫用的回報。遠端傳送的告知畫面連過來。內容要跟程式實際做的事一致：
// 不記連線紀錄是 tools/nginx-gears.conf 的 access_log off，IP 留在記憶體 10 分鐘是 server/relay.ts 的 openWindowMs，
// 各項上限也在 server/relay.ts 與 src/tools/nearby/protocol.ts 的 MAX_TOTAL
const SECTIONS = [
  ["route", 4],
  ["sees", 4],
  ["keeps", 4],
  ["crypto", 4],
  ["limits", 4],
  ["report", 2],
] as const;

export function RemoteServerPage() {
  return (
    <section class="remote-server" aria-labelledby="remote-server-title" data-testid="remote-server">
      <h2 id="remote-server-title" class="tool-title">
        {t("remote-server.title")}
      </h2>
      <p>{t("remote-server.intro")}</p>
      {SECTIONS.map(([id, count]) => (
        <section key={id} aria-labelledby={`remote-server-${id}`}>
          <h3 id={`remote-server-${id}`}>{tDynamic(`remote-server.${id}.title`)}</h3>
          <ul>
            {Array.from({ length: count }, (_, i) => (
              <li key={i}>{tDynamic(`remote-server.${id}.${i + 1}`)}</li>
            ))}
          </ul>
        </section>
      ))}
      <div class="buttons">
        <button type="button" onClick={() => navigate("remote")}>
          {t("remote-server.back")}
        </button>
      </div>
    </section>
  );
}

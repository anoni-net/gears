import { t, tDynamic } from "../i18n/index.ts";
import { navigate } from "../router.ts";
import { IS_ONION } from "../site.ts";
import { FILES_OVER_DIRECT } from "../tools/remote/direct.ts";

// 遠端傳送的政策頁（anoni-net/gears#104）：經過哪些伺服器、看得到與保存什麼、加密的方式、使用的限制、
// 濫用的回報。遠端傳送的畫面只寫使用的限制，連到這裡（AGENTS.md「介面文字」）。內容要跟程式實際做的事一致：
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

// 傳送的路線：你這一側經過 Cloudflare（onion 版是 Tor）到中繼伺服器，再轉給對方。
// 對方那一側經過哪裡看對方的瀏覽器，寫在路線下面。箭頭只是裝飾，讀螢幕軟體唸的是清單
function Route() {
  const nodes = [t("remote-server.route.you"), IS_ONION ? "Tor" : "Cloudflare", t("remote-server.route.relay"), t("remote-server.route.peer")];
  return (
    <>
      <ol class="remote-route" aria-label={t("remote-server.route.label")} data-testid="remote-route">
        {nodes.map((name, i) => (
          <li key={i} class={i === 2 ? "relay" : i === 0 || i === 3 ? "end" : ""}>
            {i ? (
              <span class="arrow" aria-hidden="true">
                →
              </span>
            ) : null}
            <span class="node">{name}</span>
          </li>
        ))}
      </ol>
      <p class="hint remote-route-note">{t("remote-server.route.note")}</p>
    </>
  );
}

// 誰看得到什麼用表格對照。onion 版不經過 Cloudflare，少一欄，中繼伺服器也看不到你的 IP
function Who() {
  const rows = [
    ["ip", IS_ONION ? [false, false] : [true, true, false]],
    ["meta", IS_ONION ? [true, true] : [true, true, true]],
    ["content", IS_ONION ? [false, true] : [false, false, true]],
  ] as const;
  return (
    <>
      <table class="remote-who" data-testid="remote-who">
        <thead>
          <tr>
            <td />
            <th scope="col">{t("remote-server.route.relay")}</th>
            {IS_ONION ? null : <th scope="col">Cloudflare</th>}
            <th scope="col">{t("remote-server.route.peer")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([row, cells]) => (
            <tr key={row}>
              <th scope="row">{tDynamic(`remote-server.sees.row.${row}`)}</th>
              {cells.map((sees, i) => (
                <td key={i} class={sees ? "sees" : "hidden"}>
                  {t(sees ? "remote-server.sees.yes" : "remote-server.sees.no")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p>{t(IS_ONION ? "remote-server.onionNote" : "remote-server.avoid")}</p>
    </>
  );
}

export function RemoteServerPage() {
  return (
    <section class="remote-server" aria-labelledby="remote-server-title" data-testid="remote-server">
      <h1 id="remote-server-title" class="tool-title">
        {t("remote-server.title")}
      </h1>
      <p>{t("remote-server.intro")}</p>
      {SECTIONS.map(([id, count]) => (
        <section key={id} aria-labelledby={`remote-server-${id}`}>
          <h3 id={`remote-server-${id}`}>{tDynamic(`remote-server.${id}.title`)}</h3>
          {id === "route" ? <Route /> : id === "sees" ? <Who /> : null}
          <ul>
            {Array.from({ length: count }, (_, i) => (
              <li key={i}>{tDynamic(`remote-server.${id}.${i + 1}`)}</li>
            ))}
            {id === "route" && FILES_OVER_DIRECT && !IS_ONION ? <li>{t("remote-server.route.direct")}</li> : null}
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

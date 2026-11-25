import { Fragment } from "preact";
import { MODEL_CATALOG } from "../core/model-catalog.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
import { PageLink, withLink } from "./AboutPage.tsx";
import { Icon, IconCircle } from "./Icon.tsx";
import { PAGE_META, TOOL_GROUPS, type GroupId } from "./tool-meta.ts";
import { AI_NOTES, GAPS, LINKS, PEERS, type Peer, type PeerName, type PeerSection } from "./why-peers.ts";

// 為什麼做 Gears（/gears/why/）：Gears 要處理的三種情況，以及國內外已經在做同類工具的組織與專案、
// 跟 Gears 的關係（AGENTS.md「為什麼做 Gears」）。
//
// - 工具數、模型數從 TOOL_GROUPS 與 MODEL_CATALOG 算，模型的用途、授權與下載量不在這裡重寫一份，
//   連到設計原則頁的模型表（#models-list）
// - 同類工具的名稱與連結在 src/ui/why-peers.ts，說明在字串（why.peer.<id>.*）
// - 小標題的 id 給寬螢幕左欄的本頁目錄讀（src/ui/PageAside.tsx）
// - 名稱前面的 logo 從自己的網域載入（public/peers/，scripts/make-peer-logos.mjs），不連到各專案的網站。
//   放在固定的淺色底上，深色模式也看得到深色的 logo。名稱就在旁邊，圖片的 alt 留空

const BASE = import.meta.env.BASE_URL;

// logo 是 public/peers/ 的檔名，gears 是自己的網站圖示，沒有時放中性的圖示佔位
export function Logo({ logo }: { logo?: string }) {
  const src = logo === "gears" ? `${BASE}favicon.svg` : logo ? `${BASE}peers/${logo}.png` : null;
  return (
    <span class={src ? "why-logo" : "why-logo none"} aria-hidden="true" data-logo={logo ?? ""}>
      {src ? <img src={src} alt="" width={20} height={20} decoding="async" /> : <Icon name="image-off-outline" />}
    </span>
  );
}

function Names({ names }: { names: PeerName[] }) {
  return (
    <>
      {names.map((n, i) => (
        <Fragment key={n.name}>
          {i ? t("list.separator") : null}
          <Logo logo={n.logo} />
          {n.url ? (
            <a href={n.url} target="_blank" rel="noopener noreferrer">
              {n.name}
            </a>
          ) : (
            n.name
          )}
        </Fragment>
      ))}
    </>
  );
}

function PeerList({ section }: { section: PeerSection }) {
  return (
    <ul class="why-peers" data-testid={`why-peers-${section}`}>
      {PEERS.filter((p) => p.section === section).map((p) => (
        <li key={p.id} data-peer={p.id}>
          <p class="why-peer-name">
            <strong>
              <Names names={p.names} />
            </strong>
            <span class="why-peer-who">{tDynamic(`why.peer.${p.id}.who`)}</span>
          </p>
          <p class="why-peer-meta">
            <span class="why-rel">{tDynamic(`why.rel.${p.relation}`)}</span>
            <span class="why-peer-form">{tDynamic(`why.peer.${p.id}.form`)}</span>
          </p>
          <p>{tDynamic(`why.peer.${p.id}.body`)}</p>
        </li>
      ))}
    </ul>
  );
}

const groupNames = (groups: readonly GroupId[]) => list(groups.map((g) => tDynamic(`desk.group.${g}`)));

function Matrix() {
  const rows = PEERS.filter((p): p is Peer & { covers: GroupId[] } => !!p.covers?.length);
  const all = TOOL_GROUPS.map((g) => g.id);
  return (
    <div class="about-table">
      {/* 窄螢幕上每一列排成一張小卡，照設計原則頁的模型表（styles.css 的 .about-table），所以每一層明寫 role */}
      <table data-testid="why-matrix" role="table">
        <caption>{t("why.matrix.caption")}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">{t("why.matrix.col.tool")}</th>
            <th scope="col" role="columnheader">{t("why.matrix.col.covers")}</th>
            <th scope="col" role="columnheader">{t("why.matrix.col.form")}</th>
            <th scope="col" role="columnheader">{t("why.matrix.col.path")}</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          <tr class="why-gears" data-peer="gears" role="row">
            <th scope="row" role="rowheader">
              <Logo logo="gears" />
              Gears
            </th>
            <td class="why-wide" role="cell">{groupNames(all)}</td>
            <td role="cell">{t("why.matrix.gears.form")}</td>
            <td class="why-wide" role="cell">{t("why.matrix.gears.path")}</td>
          </tr>
          {rows.map((p) => (
            <tr key={p.id} data-peer={p.id} role="row">
              <th scope="row" role="rowheader">
                {p.names.map((n, i) => (
                  <Fragment key={n.name}>
                    {i ? t("list.separator") : null}
                    <Logo logo={n.logo} />
                    {n.name}
                  </Fragment>
                ))}
              </th>
              <td class="why-wide" role="cell">{groupNames(p.covers)}</td>
              <td role="cell">{tDynamic(`why.peer.${p.id}.form`)}</td>
              <td class="why-wide" role="cell">{tDynamic(`why.peer.${p.id}.path`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WhyPage() {
  const tools = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
  const outside = PEERS.filter((p) => !p.covers?.length).flatMap((p) => p.names.map((n) => n.name));
  return (
    <section class="about why" aria-labelledby="why-title" data-testid="why">
      <h1 id="why-title" class="tool-title">
        <IconCircle name={PAGE_META.why.icon} cat={PAGE_META.why.cat} />
        {t("why.title")}
      </h1>
      <p>{t("why.intro.1")}</p>
      <p>{t("why.intro.2")}</p>

      <section aria-labelledby="situations">
        <h2 id="situations">{t("why.situations.title")}</h2>
        <p>{t("why.situations.body", { n: tools })}</p>
        <dl class="why-situations" data-testid="why-situations">
          {TOOL_GROUPS.map((g) => (
            <div key={g.id}>
              <dt>{tDynamic(`desk.group.${g.id}`)}</dt>
              <dd>
                <p>{tDynamic(`why.situation.${g.id}`)}</p>
                <p class="hint">{list(g.tools.map((id) => tDynamic(`tool.${id}`)))}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="models">
        <h2 id="models">{t("why.models.title")}</h2>
        <p>{t("why.models.body", { n: MODEL_CATALOG.length })}</p>
        <ul>
          {[1, 2, 3, 4].map((n) => (
            <li key={n}>{tDynamic(`why.models.${n}`)}</li>
          ))}
        </ul>
        <p>
          {withLink(
            t("why.models.more"),
            <PageLink id="about" hash="models-list">
              {t("why.models.moreLink")}
            </PageLink>,
          )}
        </p>
        <h3 id="models-others">{t("why.models.others.title")}</h3>
        <ul class="why-ai" data-testid="why-ai">
          {AI_NOTES.map((note) => (
            <li key={note.id}>
              <strong>
                <Names names={note.names} />
              </strong>
              {t("about.more.sep")}
              {tDynamic(`why.ai.${note.id}`)}
            </li>
          ))}
        </ul>
        <p>{t("why.models.note")}</p>
      </section>

      <section aria-labelledby="peers">
        <h2 id="peers">{t("why.peers.title")}</h2>
        <p>{t("why.peers.intro")}</p>
        {TOOL_GROUPS.map((g) => (
          <Fragment key={g.id}>
            <h3 id={`peers-${g.id}`}>{tDynamic(`desk.group.${g.id}`)}</h3>
            <PeerList section={g.id} />
          </Fragment>
        ))}
      </section>

      <section aria-labelledby="taiwan">
        <h2 id="taiwan">{t("why.taiwan.title")}</h2>
        <p>{t("why.taiwan.intro")}</p>
        <PeerList section="taiwan" />
        <p class="hint">{t("why.taiwan.none")}</p>
      </section>

      <section aria-labelledby="matrix">
        <h2 id="matrix">{t("why.matrix.title")}</h2>
        <p>{t("why.matrix.intro")}</p>
        <Matrix />
        <p class="hint">{t("why.matrix.note", { names: list(outside) })}</p>
      </section>

      <section aria-labelledby="links">
        <h2 id="links">{t("why.links.title")}</h2>
        <p>{t("why.links.intro")}</p>
        <dl class="why-pairs">
          {LINKS.map(({ id, logos }) => (
            <div key={id}>
              <dt>
                {logos.map((logo) => (
                  <Logo key={logo} logo={logo} />
                ))}
                {tDynamic(`why.links.${id}.title`)}
              </dt>
              <dd>{tDynamic(`why.links.${id}.body`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="gaps">
        <h2 id="gaps">{t("why.gaps.title")}</h2>
        <dl class="why-pairs">
          {Array.from({ length: GAPS }, (_, i) => i + 1).map((n) => (
            <div key={n}>
              <dt>{tDynamic(`why.gaps.${n}.title`)}</dt>
              <dd>{tDynamic(`why.gaps.${n}.body`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="scope">
        <h2 id="scope">{t("why.scope.title")}</h2>
        <p>{t("why.scope.1")}</p>
        <p>{withLink(t("why.scope.2"), <PageLink id="feedback">{t("feedback.title")}</PageLink>)}</p>
      </section>

      <p class="hint">{t("why.updated")}</p>
    </section>
  );
}

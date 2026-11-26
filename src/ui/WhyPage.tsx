import { Fragment } from "preact";
import { t, tDynamic, list } from "../i18n/index.ts";
import { PageLink, withLink } from "./AboutPage.tsx";
import { Icon, IconCircle } from "./Icon.tsx";
import { PAGE_META, TOOL_GROUPS } from "./tool-meta.ts";
import { BUILT_ON, BUILT_SECTIONS, PEERS, type PeerName, type PeerSection } from "./why-peers.ts";

// 為什麼做 Gears（/gears/why/）：寫給讀者的介紹，不寫成報告。Gears 不是從零寫起的，工作台的功能來自
// 其他人訂的規格、寫的程式、訓練的模型，以及先做過同類工具的專案（AGENTS.md「為什麼做 Gears」）。
// 順序：三種情況、Gears 用到的開源成果、其他也在做的工具、Gears 自己做的部分、一起參與
//
// - 工具數從 TOOL_GROUPS 算，模型的用途、授權與下載量不在這裡重寫一份，連到設計原則頁的模型表（#models-list）
// - 資料在 src/ui/why-peers.ts，說明在字串（why.built.<id>.*、why.peer.<id>.*）
// - 小標題的 id 給寬螢幕左欄的本頁目錄讀（src/ui/PageAside.tsx）
// - 同類工具的名稱前面放該專案的 logo，從自己的網域載入（public/peers/，scripts/make-peer-logos.mjs），
//   不連到各專案的網站。放在固定的淺色底上，深色模式也看得到深色的 logo。名稱就在旁邊，圖片的 alt 留空

const BASE = import.meta.env.BASE_URL;

// logo 是 public/peers/ 的檔名，沒有時放中性的圖示佔位
export function Logo({ logo }: { logo?: string }) {
  const src = logo ? `${BASE}peers/${logo}.png` : null;
  return (
    <span class={src ? "why-logo" : "why-logo none"} aria-hidden="true" data-logo={logo ?? ""}>
      {src ? <img src={src} alt="" width={20} height={20} decoding="async" /> : <Icon name="image-off-outline" />}
    </span>
  );
}

// 名稱與連結，withLogo 時名稱前面放 logo（同類工具）
function Names({ names, withLogo = false }: { names: PeerName[]; withLogo?: boolean }) {
  return (
    <>
      {names.map((n, i) => (
        <Fragment key={n.name}>
          {i ? t("list.separator") : null}
          {withLogo ? <Logo logo={n.logo} /> : null}
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
              <Names names={p.names} withLogo />
            </strong>
            <span class="why-peer-who">{list([tDynamic(`why.peer.${p.id}.who`), tDynamic(`why.peer.${p.id}.form`)])}</span>
          </p>
          <p>{tDynamic(`why.peer.${p.id}.body`)}</p>
        </li>
      ))}
    </ul>
  );
}

export function WhyPage() {
  const tools = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
  return (
    <section class="about why" aria-labelledby="why-title" data-testid="why">
      <h1 id="why-title" class="tool-title">
        <IconCircle name={PAGE_META.why.icon} cat={PAGE_META.why.cat} />
        {t("why.title")}
      </h1>
      <p>{t("why.intro.1")}</p>
      <p>{t("why.intro.2")}</p>
      <p>{t("why.intro.3")}</p>

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

      <section aria-labelledby="built">
        <h2 id="built">{t("why.built.title")}</h2>
        <p>{t("why.built.intro")}</p>
        {BUILT_SECTIONS.map((section) => (
          <Fragment key={section}>
            <h3 id={`built-${section}`}>{tDynamic(`why.built.${section}.title`)}</h3>
            <p>{tDynamic(`why.built.${section}.intro`)}</p>
            <ul class="why-built" data-testid={`why-built-${section}`}>
              {BUILT_ON.filter((b) => b.section === section).map((b) => (
                <li key={b.id} data-built={b.id}>
                  <strong>
                    <Names names={b.names} />
                  </strong>
                  <span class="why-peer-who">{tDynamic(`why.built.${b.id}.by`)}</span>
                  <span class="why-built-use">{tDynamic(`why.built.${b.id}`)}</span>
                </li>
              ))}
            </ul>
            {section === "models" ? (
              <p>
                {withLink(
                  t("why.built.models.note"),
                  <PageLink id="about" hash="models-list">
                    {t("why.built.models.link")}
                  </PageLink>,
                )}
              </p>
            ) : null}
          </Fragment>
        ))}
        <p>{withLink(t("why.built.licenses"), <PageLink id="licenses">{t("licenses.title")}</PageLink>)}</p>
      </section>

      <section aria-labelledby="peers">
        <h2 id="peers">{t("why.peers.title")}</h2>
        <p>{t("why.peers.intro")}</p>
        {[...TOOL_GROUPS.map((g) => g.id), "taiwan" as const].map((section) => (
          <Fragment key={section}>
            <h3 id={`peers-${section}`}>{section === "taiwan" ? t("why.taiwan.title") : tDynamic(`desk.group.${section}`)}</h3>
            {section === "taiwan" ? <p>{t("why.taiwan.intro")}</p> : null}
            <PeerList section={section} />
          </Fragment>
        ))}
      </section>

      <section aria-labelledby="own">
        <h2 id="own">{t("why.own.title")}</h2>
        <p>{t("why.own.1")}</p>
        <p>{t("why.own.2")}</p>
        <p>{withLink(t("why.own.3"), <PageLink id="about">{t("about.title")}</PageLink>)}</p>
      </section>

      <section aria-labelledby="join">
        <h2 id="join">{t("why.join.title")}</h2>
        <p>{t("why.join.1")}</p>
        <ul>
          <li>{withLink(t("why.join.feedback"), <PageLink id="feedback">{t("feedback.title")}</PageLink>)}</li>
          <li>{withLink(t("why.join.testing"), <PageLink id="testing">{t("testing.title")}</PageLink>)}</li>
          <li>
            {withLink(
              t("why.join.source"),
              <a href="https://github.com/anoni-net/gears" target="_blank" rel="noopener noreferrer">
                anoni-net/gears
              </a>,
            )}
          </li>
        </ul>
        <p class="hint">{t("why.join.scope")}</p>
      </section>

      <p class="hint">{t("why.updated")}</p>
    </section>
  );
}

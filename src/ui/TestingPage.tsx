import { t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { IconCircle } from "./Icon.tsx";
import { PAGE_META } from "./tool-meta.ts";

// 協助測試（/gears/testing/）：社群需要讀者用自己的裝置幫忙的測試，每一項寫出為什麼需要、要哪些裝置、
// 做法與會送出什麼。模型要在讀者手上的手機與電腦都能用，社群自己只有幾台裝置，數字要靠大家
// （AGENTS.md「協助測試」）。
//
// 新增一項：在 REQUESTS 加一筆，三個語系加上 testing.<id>.title、why、who.<n>、step.<n>、sent，
// 需要時加上 whoNote。page 是做法裡要打開的頁面，issue 是 anoni-net/gears 上討論與整理結果的票。
// 測試結束就把那一筆拿掉，字串一起刪
const REQUESTS = [
  { id: "phone", who: 5, steps: 5, page: "bench", issue: 144 },
  { id: "vad", who: 3, steps: 5, page: "transcribe", issue: 196 },
  { id: "punct", who: 3, steps: 5, page: "transcribe", issue: 199 },
] as const;

const ISSUES = "https://github.com/anoni-net/gears/issues/";

export function TestingPage() {
  return (
    <section class="testing" aria-labelledby="testing-title" data-testid="testing">
      <h1 id="testing-title" class="tool-title">
        <IconCircle name={PAGE_META.testing.icon} cat={PAGE_META.testing.cat} />
        {t("testing.title")}
      </h1>
      <p>{t("testing.intro")}</p>
      {REQUESTS.map((r) => (
        <section key={r.id} class="testing-request" aria-labelledby={`testing-${r.id}`} data-testid={`testing-${r.id}`}>
          <h2 id={`testing-${r.id}`}>{tDynamic(`testing.${r.id}.title`)}</h2>
          <p>{tDynamic(`testing.${r.id}.why`)}</p>
          <h3>{t("testing.who")}</h3>
          <ul>
            {Array.from({ length: r.who }, (_, i) => (
              <li key={i}>{tDynamic(`testing.${r.id}.who.${i + 1}`)}</li>
            ))}
          </ul>
          <p class="hint">{tDynamic(`testing.${r.id}.whoNote`)}</p>
          <h3>{t("testing.steps")}</h3>
          <ol>
            {Array.from({ length: r.steps }, (_, i) => (
              <li key={i}>{tDynamic(`testing.${r.id}.step.${i + 1}`)}</li>
            ))}
          </ol>
          <div class="buttons">
            <a class="button primary" href={routeUrl(r.page)} onClick={(e) => onRouteClick(e, () => navigate(r.page))}>
              {tDynamic(`testing.${r.id}.open`)}
            </a>
          </div>
          <p class="hint">
            {tDynamic(`testing.${r.id}.sent`)}{" "}
            <a href={`${ISSUES}${r.issue}`} target="_blank" rel="noopener noreferrer">
              {t("testing.issue", { n: r.issue })}
            </a>
          </p>
        </section>
      ))}
      <section class="testing-request" aria-labelledby="testing-report">
        <h2 id="testing-report">{t("testing.report.title")}</h2>
        <p>{t("testing.report.body")}</p>
        <div class="buttons">
          <a class="button" href={routeUrl("feedback")} onClick={(e) => onRouteClick(e, () => navigate("feedback"))}>
            {t("feedback.title")}
          </a>
        </div>
      </section>
      <p class="hint">{t("testing.updated")}</p>
    </section>
  );
}

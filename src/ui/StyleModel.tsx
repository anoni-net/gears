import { useEffect, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { PII_MB } from "../tools/redact/pii-model.ts";
import { type ModelTerm, modelTerms, nextAlias } from "../tools/writing-style/index.ts";
import { aliasFormat } from "./AliasForm.tsx";
import { type DetectDownload, detectDownload } from "./detect-download.ts";
import { Icon } from "./Icon.tsx";
import { onPhone } from "./phone.ts";
import { type PiiDetector, crashedBefore, piiDetector } from "./pii-detect.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { wasmAvailable } from "./wasm.ts";
import { useWorking } from "./working.ts";

// 寫作習慣檢查的「找人名、地址與單位」（#143）：貼上的文字交給個資辨識模型（nym-pii，跟遮蔽、檢查畫面內容
// 同一個模型與快取，src/ui/pii-detect.ts），找到的人名、地址與單位列成清單，讀者逐項確認之後換成代稱
// （〔人名 A〕，跟自行指定的表單同一套 replaceTerm）。不自動替換，模型會漏也會認錯。
// 文字只在這個分頁裡處理。手機上第一次按下時先說明，上一次頁面重新載入過（記憶體不夠）時不再提供，
// 做法照檢查畫面內容（ScreenCheck.tsx）

type Step = { step: "idle" | "asking" | "failed" | "noWasm" } | { step: "running"; progress: number | null } | { step: "done"; terms: ModelTerm[] };

interface Props {
  text: string;
  keep: readonly string[]; // 已經換上的代稱，裡面的字不列
  onReplace(word: string, alias: string): void;
}

const occurrences = (text: string, term: string) => text.split(term).length - 1;

export function StyleModel({ text, keep, onReplace }: Props) {
  const [state, setState] = useState<Step>({ step: "idle" });
  const [download, setDownload] = useState<DetectDownload | null>(null);
  const [crashed] = useState(crashedBefore);
  const [phone] = useState(onPhone);
  const confirmed = useRef(!phone);
  const detector = useRef<PiiDetector | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void detectDownload().then((d) => alive.current && setDownload(d));
    return () => {
      alive.current = false;
      detector.current?.dispose();
    };
  }, []);
  const running = state.step === "running";
  useWorking(running);

  const run = async () => {
    if (!wasmAvailable()) return setState({ step: "noWasm" });
    if (!confirmed.current) return setState({ step: "asking" });
    setState({ step: "running", progress: null });
    detector.current ??= piiDetector();
    const source = text;
    try {
      const spans = await detector.current.findText(source, (progress) => alive.current && setState({ step: "running", progress }));
      if (!alive.current) return;
      setState({ step: "done", terms: modelTerms(source, spans, keep) });
    } catch (error) {
      if (!alive.current) return;
      // 讀者按了停止（dispose），回到可以再按一次的狀態
      if ((error as Error).message === "disposed") return setState({ step: "idle" });
      setState({ step: "failed" });
    }
  };

  const stop = () => {
    detector.current?.dispose();
    detector.current = null;
  };

  // 換上代稱之後不在文字裡的就不列
  const terms = state.step === "done" ? state.terms.filter((m) => occurrences(text, m.term) > 0) : [];
  const status = (() => {
    switch (state.step) {
      case "running":
        return t(state.progress === null ? "style.model.loading" : "style.model.downloading");
      case "done":
        return state.terms.length ? t("style.model.found", { n: state.terms.length }) : t("style.model.none");
      case "failed":
        return t("style.model.failed");
      case "noWasm":
        return t("style.model.noWasm");
      default:
        return "";
    }
  })();
  const offer = state.step === "idle" || state.step === "asking" || state.step === "failed" || state.step === "done";

  return (
    <section class="style-model" aria-labelledby="style-model-title" data-testid="style-model" aria-busy={running}>
      <h3 id="style-model-title">{t("style.model.title")}</h3>
      {crashed ? (
        <p class="callout" data-testid="style-model-crashed">
          {t("style.model.crashed")}
        </p>
      ) : (
        <>
          {!phone && download?.pii ? (
            <p class="hint" data-testid="style-model-note">
              {t("style.model.note", { mb: download.pii })}
            </p>
          ) : (
            <p class="hint">{t("style.model.intro")}</p>
          )}
          {offer ? (
            <div class="buttons">
              <button type="button" disabled={!text.trim()} onClick={() => void run()}>
                <span class="tool-tag" aria-hidden="true">
                  <Icon name="brain" />
                </span>
                {t(state.step === "done" ? "style.model.again" : "style.model.button")}
              </button>
            </div>
          ) : null}
          {state.step === "asking" ? (
            <div class="redact-model-ask" data-testid="style-model-ask" role="group" aria-label={t("style.model.button")}>
              <p>{t("style.model.phone", { mb: download?.pii || PII_MB })}</p>
              <div class="buttons">
                <button
                  type="button"
                  class="primary"
                  onClick={() => {
                    confirmed.current = true;
                    void run();
                  }}
                >
                  {t("common.phoneGo")}
                </button>
                <a class="button" href={routeUrl("testing")} onClick={(e) => onRouteClick(e, () => navigate("testing"))}>
                  {t("common.phoneTest")}
                </a>
              </div>
            </div>
          ) : null}
          {status ? (
            <p class={state.step === "failed" || state.step === "noWasm" ? "error" : "hint"} role="status" data-testid="style-model-status">
              {status}
            </p>
          ) : null}
          {state.step === "running" ? (
            <>
              <ProgressBar label={t("style.model.button")} value={state.progress} />
              <div class="buttons">
                <button type="button" onClick={stop}>
                  {t("style.model.stop")}
                </button>
              </div>
            </>
          ) : null}
          {terms.length ? (
            <ul class="style-examples" data-testid="style-model-terms">
              {terms.map((m) => {
                const alias = nextAlias(text, aliasFormat(m.kind));
                const n = occurrences(text, m.term);
                return (
                  <li key={`${m.kind}:${m.term}`}>
                    <code>{m.term}</code>
                    <span class="hint">{tDynamic(`alias.kind.${m.kind}`)}</span>
                    <button
                      type="button"
                      class="small"
                      aria-label={t("style.model.applyLabel", { term: m.term, alias }) + (n > 1 ? t("style.count", { n }) : "")}
                      onClick={() => onReplace(m.term, alias)}
                    >
                      {t("style.model.apply", { alias }) + (n > 1 ? t("style.count", { n }) : "")}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

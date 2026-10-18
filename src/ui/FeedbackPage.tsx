import { useState } from "preact/hooks";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { COMMIT, VERSION } from "../version.ts";
import {
  FEEDBACK_FREQUENCIES,
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  type Feedback,
  type FeedbackFrequency,
  type FeedbackKind,
  type FeedbackResult,
  sendFeedback,
  feedbackPayload,
  feedbackReady,
} from "../feedback.ts";
import { IconCircle } from "./Icon.tsx";
import { PAGE_META } from "./tool-meta.ts";

// 決定要做的需求整理成 anoni-net/gears 的 issue，掛 request 標籤
const LIST_URL = "https://github.com/anoni-net/gears/issues?q=label%3Arequest";

const empty = { kind: undefined, goal: "", current: "", frequency: undefined, contact: "" };

// 建議與回饋（src/feedback.ts）。from 是讀者從哪個工具過來，跟著需求一起送出，畫面上寫明
export function FeedbackPage({ from }: { from: string }) {
  const [feedback, setFeedback] = useState<Partial<Feedback>>(empty);
  const [status, setStatus] = useState<"idle" | "sending" | FeedbackResult>("idle");
  const set = (patch: Partial<Feedback>) => {
    setFeedback({ ...feedback, ...patch });
    if (status !== "sending") setStatus("idle");
  };
  const goalLength = (feedback.goal ?? "").trim().length;

  const send = async () => {
    if (!feedbackReady(feedback)) return;
    setStatus("sending");
    const locale = getLocale();
    const payload = feedbackPayload(feedback as Feedback, { tool: from, locale, version: `${VERSION} ${COMMIT}` }, (key) => tDynamic(key));
    setStatus(await sendFeedback(payload));
  };

  const title = (
    <h2 id="feedback-title" class="tool-title">
      <IconCircle name={PAGE_META.feedback.icon} cat={PAGE_META.feedback.cat} />
      {t("feedback.title")}
    </h2>
  );

  if (status === "sent") {
    return (
      <section class="feedback" aria-labelledby="feedback-title">
        {title}
        <div class="alert" role="status" data-testid="feedback-sent">
          <p>
            <strong>{t("feedback.sent")}</strong>
          </p>
          <p>{t("feedback.sent.desc")}</p>
        </div>
        <div class="buttons">
          <a class="button" href={LIST_URL} target="_blank" rel="noopener noreferrer">
            {t("feedback.sent.list")}
          </a>
          <button
            type="button"
            onClick={() => {
              setFeedback(empty);
              setStatus("idle");
            }}
          >
            {t("feedback.again")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="feedback" aria-labelledby="feedback-title">
      {title}
      <p class="hint">{t("feedback.intro")}</p>

      <fieldset class="segmented" disabled={status === "sending"}>
        <legend>{t("feedback.kind")}</legend>
        {FEEDBACK_KINDS.map((kind: FeedbackKind) => (
          <label key={kind}>
            <input type="radio" name="feedback-kind" checked={feedback.kind === kind} onChange={() => set({ kind })} />
            {tDynamic(`feedback.kind.${kind}`)}
          </label>
        ))}
      </fieldset>

      <label class="field">
        {t("feedback.goal")}
        <span class="hint">{t("feedback.goal.hint")}</span>
        <textarea
          rows={5}
          value={feedback.goal}
          maxLength={FEEDBACK_LIMITS.goal}
          placeholder={t("feedback.goal.placeholder")}
          disabled={status === "sending"}
          onInput={(e) => set({ goal: e.currentTarget.value })}
          data-testid="feedback-goal"
        />
      </label>
      {goalLength > 0 && goalLength < FEEDBACK_LIMITS.goalMin ? (
        <p class="hint" aria-live="polite">
          {t("feedback.goal.short", { n: FEEDBACK_LIMITS.goalMin })}
        </p>
      ) : null}

      <label class="field">
        {t("feedback.current")}
        <span class="hint">{t("feedback.current.hint")}</span>
        <textarea
          rows={2}
          value={feedback.current}
          maxLength={FEEDBACK_LIMITS.current}
          disabled={status === "sending"}
          onInput={(e) => set({ current: e.currentTarget.value })}
        />
      </label>

      <fieldset class="segmented" disabled={status === "sending"}>
        <legend>{t("feedback.frequency")}</legend>
        {FEEDBACK_FREQUENCIES.map((frequency: FeedbackFrequency) => (
          <label key={frequency}>
            <input type="radio" name="feedback-frequency" checked={feedback.frequency === frequency} onChange={() => set({ frequency })} />
            {tDynamic(`feedback.frequency.${frequency}`)}
          </label>
        ))}
      </fieldset>

      <label class="field">
        {t("feedback.contact")}
        <span class="hint">{t("feedback.contact.hint")}</span>
        {/* email、通訊軟體的帳號都可以，不限定格式 */}
        <input
          type="text"
          value={feedback.contact}
          maxLength={FEEDBACK_LIMITS.contact}
          placeholder={t("feedback.contact.placeholder")}
          autocomplete="off"
          spellcheck={false}
          disabled={status === "sending"}
          onInput={(e) => set({ contact: e.currentTarget.value })}
        />
      </label>

      <p class="hint" data-testid="feedback-privacy">
        {t("feedback.privacy")}
      </p>
      {status === "closed" || status === "network" || status === "other" ? (
        <p class="error" role="alert">
          {tDynamic(`feedback.error.${status}`)}
        </p>
      ) : null}
      <div class="buttons">
        <button type="button" class="primary" disabled={!feedbackReady(feedback) || status === "sending"} onClick={() => void send()}>
          {status === "sending" ? t("feedback.sending") : t("feedback.send")}
        </button>
      </div>
    </section>
  );
}

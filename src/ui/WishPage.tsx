import { useState } from "preact/hooks";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { COMMIT, VERSION } from "../version.ts";
import {
  WISH_FREQUENCIES,
  WISH_KINDS,
  WISH_LIMITS,
  type Wish,
  type WishFrequency,
  type WishKind,
  type WishResult,
  sendWish,
  wishPayload,
  wishReady,
} from "../wish.ts";
import { IconCircle } from "./Icon.tsx";
import { PAGE_META } from "./tool-meta.ts";

// 決定要做的需求整理成 anoni-net/gears 的 issue，掛 request 標籤
const LIST_URL = "https://github.com/anoni-net/gears/issues?q=label%3Arequest";

const empty = { kind: undefined, goal: "", current: "", frequency: undefined, contact: "" };

// 許願區（src/wish.ts）。from 是讀者從哪個工具過來，跟著需求一起送出，畫面上寫明
export function WishPage({ from }: { from: string }) {
  const [wish, setWish] = useState<Partial<Wish>>(empty);
  const [status, setStatus] = useState<"idle" | "sending" | WishResult>("idle");
  const set = (patch: Partial<Wish>) => {
    setWish({ ...wish, ...patch });
    if (status !== "sending") setStatus("idle");
  };
  const goalLength = (wish.goal ?? "").trim().length;

  const send = async () => {
    if (!wishReady(wish)) return;
    setStatus("sending");
    const locale = getLocale();
    const payload = wishPayload(wish as Wish, { tool: from, locale, version: `${VERSION} ${COMMIT}` }, (key) => tDynamic(key));
    setStatus(await sendWish(payload));
  };

  const title = (
    <h2 id="wish-title" class="tool-title">
      <IconCircle name={PAGE_META.wish.icon} cat={PAGE_META.wish.cat} />
      {t("wish.title")}
    </h2>
  );

  if (status === "sent") {
    return (
      <section class="wish" aria-labelledby="wish-title">
        {title}
        <div class="alert" role="status" data-testid="wish-sent">
          <p>
            <strong>{t("wish.sent")}</strong>
          </p>
          <p>{t("wish.sent.desc")}</p>
        </div>
        <div class="buttons">
          <a class="button" href={LIST_URL} target="_blank" rel="noopener noreferrer">
            {t("wish.sent.list")}
          </a>
          <button
            type="button"
            onClick={() => {
              setWish(empty);
              setStatus("idle");
            }}
          >
            {t("wish.again")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="wish" aria-labelledby="wish-title">
      {title}
      <p class="hint">{t("wish.intro")}</p>

      <fieldset class="segmented" disabled={status === "sending"}>
        <legend>{t("wish.kind")}</legend>
        {WISH_KINDS.map((kind: WishKind) => (
          <label key={kind}>
            <input type="radio" name="wish-kind" checked={wish.kind === kind} onChange={() => set({ kind })} />
            {tDynamic(`wish.kind.${kind}`)}
          </label>
        ))}
      </fieldset>

      <label class="field">
        {t("wish.goal")}
        <span class="hint">{t("wish.goal.hint")}</span>
        <textarea
          rows={5}
          value={wish.goal}
          maxLength={WISH_LIMITS.goal}
          placeholder={t("wish.goal.placeholder")}
          disabled={status === "sending"}
          onInput={(e) => set({ goal: e.currentTarget.value })}
          data-testid="wish-goal"
        />
      </label>
      {goalLength > 0 && goalLength < WISH_LIMITS.goalMin ? (
        <p class="hint" aria-live="polite">
          {t("wish.goal.short", { n: WISH_LIMITS.goalMin })}
        </p>
      ) : null}

      <label class="field">
        {t("wish.current")}
        <span class="hint">{t("wish.current.hint")}</span>
        <textarea
          rows={2}
          value={wish.current}
          maxLength={WISH_LIMITS.current}
          disabled={status === "sending"}
          onInput={(e) => set({ current: e.currentTarget.value })}
        />
      </label>

      <fieldset class="segmented" disabled={status === "sending"}>
        <legend>{t("wish.frequency")}</legend>
        {WISH_FREQUENCIES.map((frequency: WishFrequency) => (
          <label key={frequency}>
            <input type="radio" name="wish-frequency" checked={wish.frequency === frequency} onChange={() => set({ frequency })} />
            {tDynamic(`wish.frequency.${frequency}`)}
          </label>
        ))}
      </fieldset>

      <label class="field">
        {t("wish.contact")}
        <span class="hint">{t("wish.contact.hint")}</span>
        <input
          type="email"
          value={wish.contact}
          maxLength={WISH_LIMITS.contact}
          placeholder="you@example.com"
          autocomplete="email"
          disabled={status === "sending"}
          onInput={(e) => set({ contact: e.currentTarget.value })}
        />
      </label>

      <p class="hint" data-testid="wish-privacy">
        {t("wish.privacy")}
      </p>
      {status === "closed" || status === "network" || status === "other" ? (
        <p class="error" role="alert">
          {tDynamic(`wish.error.${status}`)}
        </p>
      ) : null}
      <div class="buttons">
        <button type="button" class="primary" disabled={!wishReady(wish) || status === "sending"} onClick={() => void send()}>
          {status === "sending" ? t("wish.sending") : t("wish.send")}
        </button>
      </div>
    </section>
  );
}

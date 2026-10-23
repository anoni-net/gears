import { useState } from "preact/hooks";
import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { COMMIT, VERSION } from "../version.ts";
import { BENCH_DEVICES, BENCH_LIMITS, BENCH_MEMORIES, type BenchAnswers, type BenchDevice, type BenchMemory, benchPayload, benchReady } from "../bench-submit.ts";
import { type FeedbackResult, sendFeedback } from "../feedback.ts";

// 裝置量測的「送給社群」：讀者補上裝置類型、大約的年份與記憶體，確認過要送出的內容之後才送（src/bench-submit.ts）。
// 瀏覽器回報的核心數與記憶體不可信，所以另外請讀者自己填。不會自動送出
const DEVICES = Object.keys(BENCH_DEVICES) as BenchDevice[];
const MEMORIES = Object.keys(BENCH_MEMORIES) as BenchMemory[];

export function BenchSubmit({ report, disabled }: { report: string; disabled: boolean }) {
  const [answers, setAnswers] = useState<BenchAnswers>({ year: "", note: "" });
  const [status, setStatus] = useState<"idle" | "sending" | FeedbackResult>("idle");
  // 送出過的那一份，量測結果沒有變就不再送一次
  const [sent, setSent] = useState("");
  const set = (patch: Partial<BenchAnswers>) => {
    setAnswers({ ...answers, ...patch });
    if (status !== "sending") setStatus("idle");
  };
  const busy = status === "sending" || disabled;
  const already = !!report && report === sent;

  const send = async () => {
    if (!benchReady(answers, report)) return;
    setStatus("sending");
    const result = await sendFeedback(benchPayload(answers, report, { locale: getLocale(), version: `${VERSION} ${COMMIT}` }));
    if (result === "sent") setSent(report);
    setStatus(result);
  };

  return (
    <section class="bench-section" aria-labelledby="bench-send-title">
      <h3 id="bench-send-title">{t("bench.send.title")}</h3>
      <p class="hint">{t("bench.send.intro")}</p>

      <fieldset class="segmented" disabled={busy}>
        <legend>{t("bench.send.device")}</legend>
        {DEVICES.map((device) => (
          <label key={device}>
            <input type="radio" name="bench-device-kind" checked={answers.device === device} onChange={() => set({ device })} />
            {tDynamic(`bench.send.device.${device}`)}
          </label>
        ))}
      </fieldset>

      <label class="field">
        {t("bench.send.year")}
        <input
          type="text"
          inputMode="numeric"
          value={answers.year}
          maxLength={BENCH_LIMITS.year}
          placeholder={t("bench.send.year.placeholder")}
          autocomplete="off"
          disabled={busy}
          onInput={(e) => set({ year: e.currentTarget.value })}
        />
      </label>

      <fieldset class="segmented" disabled={busy}>
        <legend>{t("bench.send.memory")}</legend>
        {MEMORIES.map((memory) => (
          <label key={memory}>
            <input type="radio" name="bench-memory" checked={answers.memory === memory} onChange={() => set({ memory })} />
            {tDynamic(`bench.send.memory.${memory}`)}
          </label>
        ))}
      </fieldset>

      <label class="field">
        {t("bench.send.note")}
        <span class="hint">{t("bench.send.note.hint")}</span>
        <textarea rows={2} value={answers.note} maxLength={BENCH_LIMITS.note} disabled={busy} onInput={(e) => set({ note: e.currentTarget.value })} />
      </label>

      <p class="hint" data-testid="bench-send-privacy">
        {t("bench.send.privacy")}
      </p>
      {report.length > BENCH_LIMITS.report ? (
        <p class="error" role="alert">
          {t("bench.send.tooLong")}
        </p>
      ) : null}
      {status === "closed" || status === "network" || status === "other" ? (
        <p class="error" role="alert">
          {tDynamic(`bench.send.error.${status}`)}
        </p>
      ) : null}
      {status === "sent" ? (
        <p class="alert" role="status" data-testid="bench-sent">
          {t("bench.send.sent")}
        </p>
      ) : null}
      <div class="buttons">
        <button type="button" class="primary" disabled={!benchReady(answers, report) || busy || already} onClick={() => void send()}>
          {status === "sending" ? t("bench.send.sending") : t("bench.send.button")}
        </button>
      </div>
    </section>
  );
}

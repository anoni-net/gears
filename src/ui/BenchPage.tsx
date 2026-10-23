import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { COMMIT, VERSION } from "../version.ts";
import { type BenchEnv, probeEnv } from "./bench-env.ts";
import { CopyButton } from "./CopyButton.tsx";
import { type LlmRun, LlmBench, llmReport } from "./LlmBench.tsx";
import { type OcrRun, OcrBench, ocrReport } from "./OcrBench.tsx";
import { useWorking } from "./working.ts";

// 裝置量測（實驗頁，/gears/bench/，#157）：在這台裝置的瀏覽器裡量 Gears 用到的模型要多久，
// 給社群收集手機、平板與舊電腦的數字（#144）。區塊各自執行，結果合成一份 JSON 讓參加的人複製。
// 原本只量語言模型，網址是 /gears/llm-bench/，舊網址不轉址。
// 桌面不放入口，只從頁尾連過去，不進 sitemap。

// 結果的格式有變時加一，整理數字的人才分得出新舊
const SCHEMA = 1;

export function BenchPage() {
  const [env, setEnv] = useState<BenchEnv | null>(null);
  const [busy, setBusy] = useState(false);
  const [ocr, setOcr] = useState<OcrRun[]>([]);
  const [llm, setLlm] = useState<LlmRun[]>([]);
  useWorking(busy);

  useEffect(() => {
    void probeEnv().then(setEnv);
  }, []);

  const report = JSON.stringify(
    { schema: SCHEMA, version: VERSION, commit: COMMIT, env, userAgent: navigator.userAgent, ocr: ocrReport(ocr), llm: llmReport(llm) },
    null,
    2,
  );

  return (
    <section class="bench" aria-labelledby="bench-title">
      <h2 id="bench-title" class="tool-title">
        {t("bench.title")}
      </h2>
      <p class="hint">{t("bench.pageIntro")}</p>
      <p class="hint" data-testid="bench-env">
        {env
          ? t("bench.env", {
              cores: env.cores,
              threads: env.isolated ? t("bench.isolated") : t("bench.notIsolated"),
              gpu: env.gpu ? `${env.gpu.vendor ?? ""} ${env.gpu.architecture ?? ""}`.trim() + (env.gpu.f16 ? " · f16" : "") + (env.gpu.fallback ? ` · ${t("bench.fallback")}` : "") : t("bench.noGpuShort"),
            }) + (env.memory ? t("bench.memory", { gb: env.memory }) : "")
          : t("bench.probing")}
      </p>

      <OcrBench env={env} runs={ocr} setRuns={setOcr} busy={busy} setBusy={setBusy} />
      <LlmBench env={env} runs={llm} setRuns={setLlm} busy={busy} setBusy={setBusy} />

      <section class="bench-section" aria-labelledby="bench-report-title">
        <h3 id="bench-report-title">{t("bench.report.title")}</h3>
        <p class="hint">{t("bench.report.hint")}</p>
        <div class="buttons">
          <CopyButton text={ocr.length || llm.length ? report : ""} label={t("bench.copy")} />
        </div>
        {ocr.length || llm.length ? (
          <details>
            <summary>{t("bench.report.show")}</summary>
            <pre class="bench-text" data-testid="bench-report">
              {report}
            </pre>
          </details>
        ) : null}
      </section>
    </section>
  );
}

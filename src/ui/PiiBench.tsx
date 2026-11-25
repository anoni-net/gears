import { useEffect, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { median } from "../tools/bench/ocr.ts";
import { PII_SAMPLES, type PiiSampleId, foundCount } from "../tools/bench/pii.ts";
import { PII_MB, PII_MODEL } from "../tools/redact/pii-model.ts";
import { type BenchEnv, hasGpu } from "./bench-env.ts";
import type { PiiBenchReply, PiiBenchRequest } from "./pii-bench.worker.ts";
import workerUrl from "./pii-bench.worker.ts?worker&url";
import { PrivacyLink } from "./PrivacyLink.tsx";

// 裝置量測的個資辨識：找人名、地址、機構用的 nym-pii（#139）在這台裝置上要多久、記憶體夠不夠。
// 模型約 211 MB，從 Hugging Face 下載，上線之前要先知道手機能不能用（#144）。
// 手機記憶體不夠時分頁會被系統重新載入，量測中在 history.state 記一筆，重新載入之後還看得到
// 是哪一種設定，結果記成 crashed。history.state 只在這個分頁裡，不寫進 localStorage

const REPEAT = 3;
const MARK = "gearsPiiBench";

export interface PiiConfig {
  threads: number;
  webgpu: boolean;
}

export interface PiiSampleResult {
  ms: number[];
  tokens: number;
  found: number | null; // 第一輪找到幾個應該找到的字
}

export interface PiiRun extends PiiConfig {
  id: number;
  isolated: boolean | null;
  load: number | null; // 毫秒
  bytes: number | null; // 這次實際下載的位元組，已經在快取裡時是 0
  samples: Partial<Record<PiiSampleId, PiiSampleResult>>;
  crashed?: boolean; // 量測中頁面被重新載入，多半是記憶體不夠
  error?: string;
}

const key = (c: PiiConfig) => (c.webgpu ? "webgpu" : `wasm-${c.threads}`);
const label = (c: PiiConfig) => (c.webgpu ? t("bench.webgpu") : t("bench.ocr.threadsN", { n: c.threads }));
const sec = (ms: number) => (ms / 1000).toFixed(2);
const mb = (bytes: number) => Math.round(bytes / 1e6);

const marked = (): PiiConfig | null => (history.state as Record<string, PiiConfig> | null)?.[MARK] ?? null;
const mark = (config: PiiConfig | null) => history.replaceState({ ...(history.state as object | null), [MARK]: config }, "");

let workers = 0;
let runIds = 0;

interface Props {
  env: BenchEnv | null;
  runs: PiiRun[];
  setRuns: (update: (runs: PiiRun[]) => PiiRun[]) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export function PiiBench({ env, runs, setRuns, busy, setBusy }: Props) {
  const gpu = hasGpu(env);
  const configs: PiiConfig[] = [
    { threads: 1, webgpu: false },
    { threads: 4, webgpu: false },
    { threads: 1, webgpu: true },
  ];
  const usable = (c: PiiConfig) => (c.webgpu ? gpu : c.threads === 1 || !!env?.isolated);
  const [picked, setPicked] = useState<string[]>(["wasm-1", "webgpu"]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const stopped = useRef(false);
  // 有一種設定失敗時，最後不蓋成「量測完成」，畫面留著失敗的原因
  const failed = useRef(false);
  const chosen = configs.filter((c) => usable(c) && picked.includes(key(c)));

  // 上一次量到一半頁面被重新載入：記成一筆 crashed，送出的結果看得到是哪一種設定
  useEffect(() => {
    const last = marked();
    if (!last) return;
    mark(null);
    setRuns((all) => [...all, { ...last, id: ++runIds, isolated: null, load: null, bytes: null, samples: {}, crashed: true }]);
    setStatus(t("bench.pii.crashed", { config: label(last) }));
  }, []);
  useEffect(() => () => worker.current?.terminate(), []);

  const runOne = (config: PiiConfig) =>
    new Promise<void>((resolve) => {
      const id = ++runIds;
      setRuns((all) => [...all, { ...config, id, isolated: null, load: null, bytes: null, samples: {} }]);
      const update = (change: (run: PiiRun) => Partial<PiiRun>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change(r) } : r)));
      const w = new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
      worker.current = w;
      mark(config);
      const finish = () => {
        mark(null);
        w.terminate();
        worker.current = null;
        resolve();
      };
      setStatus(t("bench.pii.loading", { config: label(config) }));
      w.onmessage = ({ data }: MessageEvent<PiiBenchReply>) => {
        if (data.type === "download") setStatus(t("bench.pii.downloading", { loaded: mb(data.loaded), total: mb(data.total) }));
        else if (data.type === "loaded") update(() => ({ load: data.ms, bytes: data.bytes, isolated: data.isolated }));
        else if (data.type === "sample") {
          const sample = PII_SAMPLES.find((s) => s.id === data.id)!;
          setStatus(t("bench.ocr.progress", { config: label(config), sample: tDynamic(`bench.pii.sample.${sample.id}`), i: data.round + 1, n: REPEAT }));
          update((r) => {
            const prev = r.samples[sample.id] ?? { ms: [], tokens: data.tokens, found: null };
            return {
              samples: {
                ...r.samples,
                [sample.id]: { ms: [...prev.ms, data.ms], tokens: data.tokens, found: data.spans ? foundCount(sample.text, sample.expect, data.spans) : prev.found },
              },
            };
          });
        } else if (data.type === "done") finish();
        else {
          failed.current = true;
          update(() => ({ error: data.message }));
          setStatus(t("bench.failed", { message: data.message }));
          finish();
        }
      };
      w.onerror = () => {
        failed.current = true;
        update(() => ({ error: "worker" }));
        finish();
      };
      const request: PiiBenchRequest = {
        device: config.webgpu ? "webgpu" : "wasm",
        threads: config.threads,
        repeat: REPEAT,
        samples: PII_SAMPLES.map((s) => ({ id: s.id, text: s.text })),
      };
      w.postMessage(request);
    });

  const start = async () => {
    stopped.current = false;
    failed.current = false;
    setRunning(true);
    setBusy(true);
    for (const config of chosen) {
      if (stopped.current) break;
      await runOne(config);
    }
    setRunning(false);
    setBusy(false);
    if (!stopped.current && !failed.current) setStatus(t("bench.pii.done"));
  };

  const stop = () => {
    stopped.current = true;
    mark(null);
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setBusy(false);
    setStatus(t("bench.stopped"));
  };

  return (
    <section class="bench-section" aria-labelledby="bench-pii-title">
      <h3 id="bench-pii-title">{t("bench.pii.title")}</h3>
      <p class="hint">{t("bench.pii.intro", { mb: PII_MB })}</p>
      <p class="callout" data-testid="bench-pii-remote">
        {t("bench.pii.remote", { mb: PII_MB })} <PrivacyLink section="models" />
      </p>

      <fieldset class="choices" disabled={busy}>
        <legend>{t("bench.ocr.configs")}</legend>
        {configs.map((c) => (
          <label class="check" key={key(c)}>
            <input
              type="checkbox"
              checked={usable(c) && picked.includes(key(c))}
              disabled={!usable(c)}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                setPicked((all) => (on ? [...all, key(c)] : all.filter((k) => k !== key(c))));
              }}
            />
            <span>
              {label(c)}
              {!usable(c) ? <small>{c.webgpu ? t("bench.noGpuShort") : t("bench.notIsolated")}</small> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div class="buttons">
        {running ? (
          <button type="button" onClick={stop}>
            {t("bench.stop")}
          </button>
        ) : (
          <button type="button" class="primary" disabled={!env || busy || !chosen.length} onClick={() => void start()}>
            {t("bench.pii.start", { mb: PII_MB })}
          </button>
        )}
      </div>
      <p role="status" data-testid="bench-pii-status">
        {status}
      </p>

      {runs.length ? (
        <div class="bench-results">
          <table data-testid="bench-pii-table">
            <thead>
              <tr>
                <th>{t("bench.ocr.col.config")}</th>
                <th>{t("bench.ocr.col.load")}</th>
                {PII_SAMPLES.map((s) => (
                  <th key={s.id}>{tDynamic(`bench.pii.sample.${s.id}`)}</th>
                ))}
                <th>{t("bench.pii.col.found")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const found = PII_SAMPLES.map((s) => run.samples[s.id]?.found);
                const total = PII_SAMPLES.reduce((n, s) => n + s.expect.length, 0);
                return (
                  <tr key={run.id}>
                    <td>
                      {label(run)}
                      {run.isolated === false && run.threads > 1 ? <small>{t("bench.ocr.singleOnly")}</small> : null}
                      {run.crashed ? <small>{t("bench.pii.crashedShort")}</small> : null}
                      {run.error ? <small>{t("bench.failed", { message: run.error })}</small> : null}
                    </td>
                    <td>{run.load !== null ? `${sec(run.load)} s` : run.crashed ? "–" : "…"}</td>
                    {PII_SAMPLES.map((s) => {
                      const r = run.samples[s.id];
                      return <td key={s.id}>{r ? `${Math.round(median(r.ms))} ms` : run.crashed ? "–" : "…"}</td>;
                    })}
                    <td>{found.every((f) => f != null) ? `${found.reduce((a, b) => a! + b!, 0)} / ${total}` : run.crashed ? "–" : "…"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="hint">{t("bench.pii.tableHint", { n: REPEAT })}</p>
        </div>
      ) : null}
    </section>
  );
}

// 複製的結果：毫秒取整數。範例文字與找到的範圍不放進去，只放找到幾個
export function piiReport(runs: PiiRun[]) {
  return runs.map(({ id: _, samples, load, ...run }) => ({
    ...run,
    model: `${PII_MODEL.repo}@${PII_MODEL.revision.slice(0, 8)}:${PII_MODEL.dtype}`,
    load: load === null ? null : Math.round(load),
    samples: Object.fromEntries(Object.entries(samples).map(([id, r]) => [id, { ms: r.ms.map(Math.round), tokens: r.tokens, found: r.found }])),
  }));
}

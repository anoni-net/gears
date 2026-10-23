import { useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { OCR_SAMPLES, type OcrSample, cer, median } from "../tools/bench/ocr.ts";
import { type BenchEnv, hasGpu } from "./bench-env.ts";
import type { OcrBenchReply, OcrBenchRequest } from "./ocr-bench.worker.ts";
import workerUrl from "./ocr-bench.worker.ts?worker&url";

// 裝置量測的文字辨識：遮蔽找個資用的 PP-OCRv5（src/ui/ppocr.ts）在這台裝置上要多久。
// 工具本身只用單執行緒的 WebAssembly，這裡另外量多執行緒與顯示卡，決定值不值得開（#140、#157）。
// 每種設定換一個 Worker，每張截圖辨識 REPEAT 次取中位數，第一次常包含編譯與暖機的時間

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;
const REPEAT = 3;
const THREADS = [1, 4, 8];

export interface OcrConfig {
  threads: number;
  webgpu: boolean;
}

export interface OcrSampleResult {
  det: number[];
  rec: number[];
  total: number[];
  cer: number | null; // 第一次的辨識結果對正確答案
}

export interface OcrRun extends OcrConfig {
  id: number;
  isolated: boolean | null; // Worker 裡能不能用多執行緒，不能的話 onnxruntime 只用 1 個
  load: number | null; // 毫秒
  samples: Partial<Record<OcrSample["id"], OcrSampleResult>>;
  error?: string;
}

const key = (c: OcrConfig) => (c.webgpu ? "webgpu" : `wasm-${c.threads}`);
const sec = (ms: number) => (ms / 1000).toFixed(2);

let workers = 0;
let runIds = 0;

interface Props {
  env: BenchEnv | null;
  runs: OcrRun[];
  setRuns: (update: (runs: OcrRun[]) => OcrRun[]) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export function OcrBench({ env, runs, setRuns, busy, setBusy }: Props) {
  const gpu = hasGpu(env);
  const configs: OcrConfig[] = [...THREADS.map((threads) => ({ threads, webgpu: false })), { threads: 1, webgpu: true }];
  const usable = (c: OcrConfig) => (c.webgpu ? gpu : c.threads === 1 || !!env?.isolated);
  const [picked, setPicked] = useState<string[]>(["wasm-1", "wasm-4", "webgpu"]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const stopped = useRef(false);
  const chosen = configs.filter((c) => usable(c) && picked.includes(key(c)));

  const runOne = (config: OcrConfig) =>
    new Promise<void>((resolve) => {
      const id = ++runIds;
      setRuns((all) => [...all, { ...config, id, isolated: null, load: null, samples: {} }]);
      const update = (change: (run: OcrRun) => Partial<OcrRun>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change(r) } : r)));
      const w = new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
      worker.current = w;
      const finish = () => {
        w.terminate();
        worker.current = null;
        resolve();
      };
      const label = config.webgpu ? t("bench.webgpu") : t("bench.ocr.threadsN", { n: config.threads });
      setStatus(t("bench.ocr.loading", { config: label }));
      w.onmessage = ({ data }: MessageEvent<OcrBenchReply>) => {
        if (data.type === "loaded") update(() => ({ load: data.ms, isolated: data.isolated }));
        else if (data.type === "sample") {
          const sample = OCR_SAMPLES.find((s) => s.id === data.id)!;
          setStatus(t("bench.ocr.progress", { config: label, sample: tDynamic(`bench.ocr.sample.${sample.id}`), i: data.round + 1, n: REPEAT }));
          update((r) => {
            const prev = r.samples[sample.id] ?? { det: [], rec: [], total: [], cer: null };
            return {
              samples: {
                ...r.samples,
                [sample.id]: {
                  det: [...prev.det, data.det],
                  rec: [...prev.rec, data.rec],
                  total: [...prev.total, data.total],
                  cer: prev.cer ?? cer(sample.lines.join(""), data.text),
                },
              },
            };
          });
        } else if (data.type === "done") finish();
        else {
          update(() => ({ error: data.message }));
          setStatus(t("bench.failed", { message: data.message }));
          finish();
        }
      };
      w.onerror = () => {
        update(() => ({ error: "worker" }));
        finish();
      };
      const request: OcrBenchRequest = {
        base: BASE,
        threads: config.threads,
        webgpu: config.webgpu,
        repeat: REPEAT,
        samples: OCR_SAMPLES.map((s) => ({ id: s.id, url: new URL(s.file, BASE).href })),
      };
      w.postMessage(request);
    });

  const start = async () => {
    stopped.current = false;
    setRunning(true);
    setBusy(true);
    for (const config of chosen) {
      if (stopped.current) break;
      await runOne(config);
    }
    setRunning(false);
    setBusy(false);
    if (!stopped.current) setStatus(t("bench.ocr.done"));
  };

  const stop = () => {
    stopped.current = true;
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setBusy(false);
    setStatus(t("bench.stopped"));
  };

  return (
    <section class="bench-section" aria-labelledby="bench-ocr-title">
      <h3 id="bench-ocr-title">{t("bench.ocr.title")}</h3>
      <p class="hint">{t("bench.ocr.intro")}</p>
      {env && !env.canvas ? (
        <p class="notice" data-testid="bench-ocr-canvas">
          {t("bench.ocr.canvasBlocked")}
        </p>
      ) : null}

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
              {c.webgpu ? t("bench.webgpu") : t("bench.ocr.threadsN", { n: c.threads })}
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
          <button type="button" class="primary" disabled={!env || !env.canvas || busy || !chosen.length} onClick={() => void start()}>
            {t("bench.ocr.start")}
          </button>
        )}
      </div>
      <p role="status" data-testid="bench-ocr-status">
        {status}
      </p>

      {runs.length ? (
        <div class="bench-results">
          <table data-testid="bench-ocr-table">
            <thead>
              <tr>
                <th>{t("bench.ocr.col.config")}</th>
                <th>{t("bench.ocr.col.load")}</th>
                {OCR_SAMPLES.map((s) => (
                  <th key={s.id}>{tDynamic(`bench.ocr.sample.${s.id}`)}</th>
                ))}
                <th>{t("bench.ocr.col.cer")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const errors = OCR_SAMPLES.map((s) => run.samples[s.id]?.cer).filter((v): v is number => v != null);
                return (
                  <tr key={run.id}>
                    <td>
                      {run.webgpu ? t("bench.webgpu") : t("bench.ocr.threadsN", { n: run.threads })}
                      {run.isolated === false && run.threads > 1 ? <small>{t("bench.ocr.singleOnly")}</small> : null}
                      {run.error ? <small>{t("bench.failed", { message: run.error })}</small> : null}
                    </td>
                    <td>{run.load !== null ? `${sec(run.load)} s` : "…"}</td>
                    {OCR_SAMPLES.map((s) => {
                      const r = run.samples[s.id];
                      return (
                        <td key={s.id}>
                          {r ? `${sec(median(r.total))} s` : "…"}
                          {r ? <small>{t("bench.ocr.det", { s: sec(median(r.det)) })}</small> : null}
                        </td>
                      );
                    })}
                    <td>{errors.length ? `${((errors.reduce((a, b) => a + b, 0) / errors.length) * 100).toFixed(1)}%` : "…"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="hint">{t("bench.ocr.tableHint", { n: REPEAT })}</p>
        </div>
      ) : null}
    </section>
  );
}

// 複製的結果：毫秒取整數，字錯率取到小數第四位
export function ocrReport(runs: OcrRun[]) {
  return runs.map(({ id: _, samples, load, ...run }) => ({
    ...run,
    load: load === null ? null : Math.round(load),
    samples: Object.fromEntries(
      Object.entries(samples).map(([id, r]) => [
        id,
        { det: r.det.map(Math.round), rec: r.rec.map(Math.round), total: r.total.map(Math.round), cer: r.cer === null ? null : Number(r.cer.toFixed(4)) },
      ]),
    ),
  }));
}

import { useEffect, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import models from "../tools/llm-bench/models.json" with { type: "json" };
import { SAMPLES } from "../tools/llm-bench/samples.ts";
import { addedNumbers, missingFacts } from "../tools/writing-style/facts.ts";
import { FIXABLE, findHabits, fixHabits } from "../tools/writing-style/index.ts";
import { CopyButton } from "./CopyButton.tsx";
import type { BenchReply, BenchRequest } from "./llm-bench.worker.ts";
import workerUrl from "./llm-bench.worker.ts?worker&url";
import { useWorking } from "./working.ts";

// 語言模型速度量測（實驗頁，/gears/llm-bench/）：在這台裝置的瀏覽器裡執行小型語言模型，改寫範例文字，
// 量測載入時間、第一個字出現的時間與每秒的詞元數，也用寫作習慣檢查的規則看改寫的品質。
// 給社群評估寫作風格改寫（研究在社群工作區的 research/gears-llm/）用，桌面不放入口，不進 sitemap。

type ModelId = keyof typeof models;
const MODEL_IDS = Object.keys(models) as ModelId[];
const THREADS = [1, 2, 4, 8, 12, 16];
const CACHE = "transformers-cache";

interface Env {
  cores: number;
  isolated: boolean;
  gpu: { vendor?: string; architecture?: string; f16: boolean; fallback: boolean } | null;
}

interface TextResult {
  index: number;
  input: string;
  firstToken: number;
  tokensPerSecond: number;
  total: number;
  tokens: number;
  output: string;
  missing: string[];
  added: string[];
  habitsLeft: number;
}

interface Run {
  id: number;
  model: string;
  device: string;
  dtype: string;
  threads: number;
  load: number | null;
  texts: TextResult[];
  error?: string;
}

async function probe(): Promise<Env> {
  const env: Env = { cores: navigator.hardwareConcurrency || 0, isolated: self.crossOriginIsolated, gpu: null };
  type Adapter = { features: Set<string>; info?: { vendor?: string; architecture?: string; isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  if (adapter)
    env.gpu = {
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      f16: adapter.features.has("shader-f16"),
      fallback: !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter),
    };
  return env;
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
// 不算標點與符號：那些由寫作習慣檢查先修掉
const manualHabits = (text: string) => findHabits(text).filter((h) => !FIXABLE.includes(h.code) && h.code !== "pii").length;

let workers = 0;
let runIds = 0;

export function LlmBench() {
  const [env, setEnv] = useState<Env | null>(null);
  // 有顯示卡時預設選 Qwen3 4B：Qwen3 1.7B 的顯示卡版是單檔模型，瀏覽器裡建立不了推論環境（見 AGENTS.md）
  const [model, setModel] = useState<ModelId>("qwen3-4b");
  const [device, setDevice] = useState<"webgpu" | "wasm">("webgpu");
  const [threads, setThreads] = useState(4);
  const [custom, setCustom] = useState("");
  const [prefix, setPrefix] = useState(true);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const worker = useRef<Worker | null>(null);
  useWorking(running);

  useEffect(() => {
    void probe().then((e) => {
      setEnv(e);
      if (!e.gpu || e.gpu.fallback) {
        setDevice("wasm");
        setModel("qwen3-0.6b");
      }
      setThreads(Math.max(...THREADS.filter((n) => n <= Math.max(1, Math.min(8, e.cores)))));
    });
    return () => worker.current?.terminate();
  }, []);

  const info = models[model];
  const gpuOnly = info.cpu === null;
  const usable = device === "webgpu" ? !!env?.gpu : !gpuOnly;
  // 顯示卡不支援 shader-f16 時改用 q4（src/tools/llm-bench/models.json 的 gpu.dtype 是 q4f16）
  const dtype = (device === "webgpu" ? (env?.gpu?.f16 ? info.gpu.dtype : "q4") : (info.cpu?.dtype ?? "q4")) as BenchRequest["dtype"];

  const start = () => {
    const originals = custom.trim() ? [custom.trim()] : SAMPLES;
    const texts = originals.map((text) => (prefix ? fixHabits(text) : text));
    const id = ++runIds;
    setRuns((all) => [...all, { id, model: info.name, device, dtype, threads, load: null, texts: [] }]);
    const update = (change: (run: Run) => Partial<Run>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change(r) } : r)));
    setRunning(true);
    setStatus(t("bench.loading"));
    const w = new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
    worker.current = w;
    const finish = () => {
      w.terminate();
      worker.current = null;
      setRunning(false);
    };
    w.onmessage = ({ data }: MessageEvent<BenchReply>) => {
      if (data.type === "download") setStatus(t("bench.downloading", { loaded: gb(data.loaded), total: gb(data.total) }));
      else if (data.type === "loaded") {
        update(() => ({ load: data.seconds }));
        setStatus(t("bench.loaded", { s: data.seconds.toFixed(1) }));
      } else if (data.type === "progress") setStatus(t("bench.progress", { i: data.index + 1, n: data.tokens }));
      else if (data.type === "text") {
        const input = originals[data.index]!;
        const result: TextResult = {
          ...data,
          input: texts[data.index]!,
          missing: missingFacts(input, data.output).map((f) => f.text),
          added: addedNumbers(input, data.output).map((f) => f.text),
          habitsLeft: manualHabits(data.output),
        };
        update((r) => ({ texts: [...r.texts, result] }));
      } else if (data.type === "done") {
        setStatus(t("bench.done"));
        finish();
      } else if (data.type === "error") {
        update(() => ({ error: data.message }));
        setStatus(t("bench.failed", { message: data.message }));
        finish();
      }
    };
    w.onerror = () => {
      setStatus(t("bench.failed", { message: "worker" }));
      finish();
    };
    const request: BenchRequest = { repo: info.repo, revision: info.revision, device, dtype, threads, texts };
    // 社群轉檔的模型（src/tools/llm-bench/models.json 的 host 是 assets）從 assets.anoni.net 下載
    if ("dir" in info) Object.assign(request, { repo: info.dir, assets: { dir: info.dir, files: info.files, parts: info.parts } });
    w.postMessage(request);
  };

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setStatus(t("bench.stopped"));
  };

  const clearCache = async () => {
    await caches.delete(CACHE);
    setStatus(t("bench.cleared"));
  };

  const report = JSON.stringify({ env, userAgent: navigator.userAgent, runs }, null, 2);

  return (
    <section class="llm-bench" aria-labelledby="bench-title">
      <h2 id="bench-title" class="tool-title">
        {t("bench.title")}
      </h2>
      <p class="hint">{t("bench.intro")}</p>
      <p class="notice" data-testid="bench-remote">
        {t("bench.remote")}
      </p>
      <p class="hint" data-testid="bench-env">
        {env
          ? t("bench.env", {
              cores: env.cores,
              threads: env.isolated ? t("bench.isolated") : t("bench.notIsolated"),
              gpu: env.gpu ? `${env.gpu.vendor ?? ""} ${env.gpu.architecture ?? ""}`.trim() + (env.gpu.f16 ? " · f16" : "") + (env.gpu.fallback ? ` · ${t("bench.fallback")}` : "") : t("bench.noGpuShort"),
            })
          : t("bench.probing")}
      </p>

      <fieldset class="choices" disabled={running}>
        <legend>{t("bench.model")}</legend>
        {MODEL_IDS.map((id) => (
          <label class="check" key={id}>
            <input type="radio" name="bench-model" checked={model === id} onChange={() => setModel(id)} />
            <span>
              {models[id].name}
              <small>
                {models[id].cpu === null
                  ? t("bench.sizeGpuOnly", { gpu: gb(models[id].gpu.bytes) })
                  : t("bench.size", { gpu: gb(models[id].gpu.bytes), cpu: gb(models[id].cpu!.bytes) })}
                {" · "}
                <a href={models[id].source} target="_blank" rel="noopener">
                  {models[id].license}
                </a>
              </small>
              {"note" in models[id] ? <small>{t("bench.note")}</small> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset class="segmented" disabled={running}>
        <legend>{t("bench.device")}</legend>
        <label>
          <input type="radio" name="bench-device" checked={device === "webgpu"} disabled={!env?.gpu} onChange={() => setDevice("webgpu")} />
          {t("bench.webgpu")}
        </label>
        <label>
          <input type="radio" name="bench-device" checked={device === "wasm"} onChange={() => setDevice("wasm")} />
          {t("bench.cpu")}
        </label>
      </fieldset>
      {device === "wasm" ? (
        <fieldset class="segmented" disabled={running || !env?.isolated}>
          <legend>{t("bench.threads")}</legend>
          {THREADS.map((n) => (
            <label key={n}>
              <input type="radio" name="bench-threads" checked={threads === n} onChange={() => setThreads(n)} />
              {n}
            </label>
          ))}
        </fieldset>
      ) : null}
      {!usable ? <p class="hint">{gpuOnly && device === "wasm" ? t("bench.gpuOnly") : t("bench.noGpu")}</p> : null}

      <label class="field">
        {t("bench.custom")}
        <textarea rows={3} value={custom} disabled={running} onInput={(e) => setCustom(e.currentTarget.value)} />
      </label>
      <p class="hint">{t("bench.customHint")}</p>
      <label class="check">
        <input type="checkbox" checked={prefix} disabled={running} onChange={(e) => setPrefix(e.currentTarget.checked)} />
        <span>{t("bench.prefix")}</span>
      </label>

      <div class="buttons">
        {running ? (
          <button type="button" onClick={stop}>
            {t("bench.stop")}
          </button>
        ) : (
          <button type="button" class="primary" disabled={!env || !usable} onClick={start}>
            {t("bench.start")}
          </button>
        )}
        {runs.length ? <CopyButton text={report} label={t("bench.copy")} primary={false} /> : null}
        <button type="button" disabled={running} onClick={() => void clearCache()}>
          {t("bench.clear")}
        </button>
      </div>
      <p role="status" data-testid="bench-status">
        {status}
      </p>

      {runs.length ? (
        <div class="bench-results">
          <table data-testid="bench-table">
            <thead>
              <tr>
                <th>{t("bench.col.model")}</th>
                <th>{t("bench.col.text")}</th>
                <th>{t("bench.col.first")}</th>
                <th>{t("bench.col.speed")}</th>
                <th>{t("bench.col.total")}</th>
                <th>{t("bench.col.facts")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.flatMap((run) =>
                run.texts.map((x) => (
                  <tr key={`${run.id}-${x.index}`}>
                    <td>
                      {run.model} · {run.device === "webgpu" ? t("bench.webgpu") : t("bench.cpu")}
                      {run.load !== null ? <small>{t("bench.loadTime", { s: run.load.toFixed(1) })}</small> : null}
                    </td>
                    <td>{x.index + 1}</td>
                    <td>{x.firstToken.toFixed(1)} s</td>
                    <td>{x.tokensPerSecond.toFixed(1)}</td>
                    <td>{x.total.toFixed(1)} s</td>
                    <td>
                      {x.missing.length || x.added.length
                        ? [
                            x.missing.length ? t("bench.missing", { items: x.missing.join(tDynamic("bench.sep")) }) : "",
                            x.added.length ? t("bench.added", { items: x.added.join(tDynamic("bench.sep")) }) : "",
                          ]
                            .filter(Boolean)
                            .join(tDynamic("bench.sep"))
                        : t("bench.factsOk")}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          {runs.map((run) =>
            run.texts.map((x) => (
              <details key={`${run.id}-${x.index}`}>
                <summary>{t("bench.outputTitle", { model: run.model, i: x.index + 1, left: x.habitsLeft })}</summary>
                <p class="hint">{t("bench.before")}</p>
                <p class="bench-text">{x.input}</p>
                <p class="hint">{t("bench.after")}</p>
                <p class="bench-text">{x.output}</p>
              </details>
            )),
          )}
        </div>
      ) : null}
    </section>
  );
}

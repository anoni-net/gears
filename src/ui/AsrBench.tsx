import { useEffect, useRef, useState } from "preact/hooks";
import { isCached } from "../core/models.ts";
import { t } from "../i18n/index.ts";
import { ASR_SAMPLE, asrCer } from "../tools/bench/asr.ts";
import type { Device, GpuInfo } from "../tools/transcribe/device.ts";
import { gpuUsable } from "../tools/transcribe/device.ts";
import { MODELS, type Segment } from "../tools/transcribe/segments.ts";
import { pcmToFloat, wavLayout } from "../tools/transcribe/sources.ts";
import type { BenchEnv } from "./bench-env.ts";
import { detectGpu } from "./gpu.ts";
import { DEFAULT_THREADS } from "./thread-default.ts";
import type { Reply, Request } from "./transcribe.worker.ts";
import workerUrl from "./transcribe.worker.ts?worker&url";
import { wasmAvailable } from "./wasm.ts";

// 裝置量測的逐字稿（#157）：Whisper base 與 small 在這台裝置的 CPU 與顯示卡上要多久，以及字錯率。
// 直接用逐字稿的 Worker（transcribe.worker.ts），送入的錄音與設定跟逐字稿相同，不另寫一份推論：
// 核心數照逐字稿的預設值（thread-default.ts），顯示卡的判斷照逐字稿（gpuUsable），CPU 用 8 位元、
// 顯示卡用 4 位元的模型。模型從工作台自己的網域下載，用過逐字稿就不必重新下載。
//
// 範例錄音見 src/tools/bench/asr.ts。同一個 Worker 辨識兩次：第一次包含顯示卡編譯 shader 的時間，
// 第二次才是之後每一段的速度。#138 要比較的 encoder 精度（fp32、fp16）需要另外的模型檔，
// 伺服器上還沒有，這裡只量逐字稿實際用的設定。
//
// 手機記憶體不夠時分頁會被系統重新載入，量測中在 history.state 記一筆（同個資辨識），重新載入之後
// 結果記成 crashed

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;
const REPEAT = 2;
const MARK = "gearsAsrBench";

type BenchModel = "base" | "small";
export interface AsrConfig {
  model: BenchModel;
  device: Device;
}

export interface AsrRun extends AsrConfig {
  id: number;
  threads: number;
  used: Device | null; // 實際用的裝置：拿不到顯示卡時 Worker 改用 CPU
  load: number | null; // 從建立 Worker 到模型載入完成，毫秒，包含下載
  download: number | null; // 其中下載模型的時間（到最後一次回報下載進度為止），毫秒
  cached: boolean | null; // 開始之前模型已經在這個瀏覽器的快取裡。從快取讀出也會回報下載進度，所以要另外記
  silero: boolean | null; // 語音偵測用 Silero，false 是退回音量判斷
  ms: number[]; // 每一次辨識的時間
  pieces: number | null; // 送進模型的片段數
  cer: number | null; // 第一次辨識的字錯率
  crashed?: boolean;
  error?: string;
}

const CONFIGS: AsrConfig[] = [
  { model: "base", device: "wasm" },
  { model: "base", device: "webgpu" },
  { model: "small", device: "wasm" },
  { model: "small", device: "webgpu" },
];

const key = (c: AsrConfig) => `${c.model}-${c.device}`;
const bytesOf = (c: AsrConfig) => (c.device === "webgpu" ? MODELS[c.model].webgpu.bytes : MODELS[c.model].bytes);
const mb = (bytes: number) => Math.round(bytes / 1e6);
const label = (c: AsrConfig) => t("bench.asr.config", { model: `Whisper ${c.model}`, device: c.device === "webgpu" ? t("bench.webgpu") : "CPU" });
const sec = (ms: number) => (ms / 1000).toFixed(2);

// 模型有沒有在快取裡，照逐字稿判斷「已下載」的做法：看那個裝置用的最後一個檔案，解碼器最後才下載
function modelCached(c: AsrConfig): Promise<boolean> {
  const files = c.device === "webgpu" ? MODELS[c.model].webgpu.files : MODELS[c.model].files;
  const file = Object.keys(files).at(-1)!;
  return isCached(`${BASE}models/whisper/${MODELS[c.model].dir}/${file}`).catch(() => false);
}

const marked = (): AsrConfig | null => (history.state as Record<string, AsrConfig> | null)?.[MARK] ?? null;
const mark = (config: AsrConfig | null) => history.replaceState({ ...(history.state as object | null), [MARK]: config }, "");

// 範例錄音讀一次就留著
let audio: Promise<Float32Array> | null = null;
function loadSample(): Promise<Float32Array> {
  audio ??= (async () => {
    const response = await fetch(new URL(ASR_SAMPLE.file, BASE));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const layout = wavLayout(bytes, bytes.length);
    if (!layout) throw new Error("wav");
    return pcmToFloat(bytes.subarray(layout.dataStart, layout.dataStart + layout.dataLength), layout)[0]!;
  })();
  audio.catch(() => (audio = null));
  return audio;
}

let workers = 0;
let runIds = 0;

interface Props {
  env: BenchEnv | null;
  runs: AsrRun[];
  setRuns: (update: (runs: AsrRun[]) => AsrRun[]) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export function AsrBench({ env, runs, setRuns, busy, setBusy }: Props) {
  const [gpu, setGpu] = useState<GpuInfo | null | undefined>(undefined);
  useEffect(() => {
    // 讀不到顯示卡的限制（瀏覽器的實作不完整）時當成沒有顯示卡
    detectGpu().then(setGpu, () => setGpu(null));
  }, []);
  const wasm = wasmAvailable();
  const usable = (c: AsrConfig) => wasm && (c.device === "wasm" || gpuUsable(gpu ?? null, MODELS[c.model].webgpu.buffer));
  const [picked, setPicked] = useState<string[]>(["base-wasm", "base-webgpu"]);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const stopped = useRef(false);
  const failed = useRef(false);
  const chosen = CONFIGS.filter((c) => usable(c) && picked.includes(key(c)));

  useEffect(() => {
    const last = marked();
    if (!last) return;
    mark(null);
    setRuns((all) => [
      ...all,
      { ...last, id: ++runIds, threads: DEFAULT_THREADS, used: null, load: null, download: null, cached: null, silero: null, ms: [], pieces: null, cer: null, crashed: true },
    ]);
    setStatus(t("bench.asr.crashed", { config: label(last) }));
  }, []);
  useEffect(() => () => worker.current?.terminate(), []);

  const runOne = (config: AsrConfig, sample: Float32Array, cached: boolean) =>
    new Promise<void>((resolve) => {
      const id = ++runIds;
      setRuns((all) => [...all, { ...config, id, threads: DEFAULT_THREADS, used: null, load: null, download: null, cached: null, silero: null, ms: [], pieces: null, cer: null }]);
      const update = (change: (run: AsrRun) => Partial<AsrRun>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change(r) } : r)));
      const w = new Worker(`${workerUrl}?n=${++workers}`, { type: "module" });
      worker.current = w;
      mark(config);
      const started = performance.now();
      let downloaded: number | null = null;
      let used: Device = config.device;
      let round = 0;
      let sent = 0;
      let text = "";
      const finish = () => {
        mark(null);
        w.terminate();
        worker.current = null;
        resolve();
      };
      const send = (request: Request) => w.postMessage(request);
      const recognize = () => {
        text = "";
        setStatus(t("bench.asr.progress", { config: label(config), i: round + 1, n: REPEAT }));
        sent = performance.now();
        // 每次送一份新的，Worker 收到的是複本
        send({ type: "chunk", audio: sample.slice(), offset: 0, last: true });
      };
      setStatus(t("bench.asr.loading", { config: label(config) }));
      w.onmessage = ({ data }: MessageEvent<Reply>) => {
        if (data.type === "download") {
          downloaded = performance.now() - started;
          setStatus(t("bench.asr.downloading", { config: label(config), loaded: mb(data.loaded), total: mb(data.total) }));
        } else if (data.type === "device") used = data.device;
        else if (data.type === "vad") update(() => ({ silero: data.silero }));
        else if (data.type === "ready") {
          update(() => ({ load: performance.now() - started, download: downloaded, cached, used }));
          recognize();
        } else if (data.type === "segments") {
          text += data.segments.map((s: Segment) => s.text).join("");
          update(() => ({ pieces: data.pieces }));
        } else if (data.type === "done") {
          const ms = performance.now() - sent;
          const first = round === 0;
          update((r) => ({ ms: [...r.ms, ms], ...(first ? { cer: asrCer(ASR_SAMPLE.lines.join(""), text) } : {}) }));
          round++;
          if (round < REPEAT && !stopped.current) recognize();
          else finish();
        } else if (data.type === "error") {
          failed.current = true;
          update(() => ({ error: data.message }));
          setStatus(t("bench.failed", { message: data.message }));
          finish();
        }
      };
      w.onerror = (event) => {
        failed.current = true;
        update(() => ({ error: event.message || "worker" }));
        finish();
      };
      send({ type: "start", model: config.model, language: ASR_SAMPLE.language, base: BASE, threads: DEFAULT_THREADS, speakers: false, device: config.device });
    });

  const start = async () => {
    stopped.current = false;
    failed.current = false;
    setRunning(true);
    setBusy(true);
    try {
      const sample = await loadSample();
      for (const config of chosen) {
        if (stopped.current) break;
        await runOne(config, sample, await modelCached(config));
      }
      if (!stopped.current && !failed.current) setStatus(t("bench.asr.done"));
    } catch (error) {
      setStatus(t("bench.asr.sampleFailed", { message: (error as Error).message }));
    } finally {
      setRunning(false);
      setBusy(false);
    }
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

  const speed = (run: AsrRun) => {
    const last = run.ms.at(-1);
    return last === undefined ? null : last / 1000 / ASR_SAMPLE.seconds;
  };

  return (
    <section class="bench-section" aria-labelledby="bench-asr-title">
      <h3 id="bench-asr-title">{t("bench.asr.title")}</h3>
      <p class="hint">{t("bench.asr.intro", { seconds: Math.round(ASR_SAMPLE.seconds), threads: DEFAULT_THREADS })}</p>
      <p class="hint">
        {t("bench.asr.source")}{" "}
        <a href="https://huggingface.co/datasets/google/fleurs" target="_blank" rel="noopener noreferrer">
          FLEURS
        </a>{" "}
        ·{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
          CC BY 4.0
        </a>
      </p>
      {!wasm ? (
        <p class="callout" data-testid="bench-asr-nowasm">
          {t("bench.asr.noWasm")}
        </p>
      ) : null}

      <fieldset class="choices" disabled={busy}>
        <legend>{t("bench.ocr.configs")}</legend>
        {CONFIGS.map((c) => (
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
              <small>{!usable(c) && wasm ? t("bench.noGpuShort") : t("bench.asr.size", { mb: mb(bytesOf(c)) })}</small>
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
            {t("bench.asr.start")}
          </button>
        )}
      </div>
      <p role="status" data-testid="bench-asr-status">
        {status}
      </p>

      {runs.length ? (
        <div class="bench-results">
          <table data-testid="bench-asr-table">
            <thead>
              <tr>
                <th>{t("bench.ocr.col.config")}</th>
                <th>{t("bench.ocr.col.load")}</th>
                <th>{t("bench.asr.col.first")}</th>
                <th>{t("bench.asr.col.again")}</th>
                <th>{t("bench.asr.col.speed")}</th>
                <th>{t("bench.ocr.col.cer")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const x = speed(run);
                const pending = run.crashed || run.error ? "–" : "…";
                return (
                  <tr key={run.id}>
                    <td>
                      {label(run)}
                      {run.used === "wasm" && run.device === "webgpu" ? <small>{t("bench.asr.fallback")}</small> : null}
                      {run.silero === false ? <small>{t("bench.asr.energy")}</small> : null}
                      {run.crashed ? <small>{t("bench.pii.crashedShort")}</small> : null}
                      {run.error ? <small>{t("bench.failed", { message: run.error })}</small> : null}
                    </td>
                    <td>
                      {run.load !== null ? `${sec(run.load)} s` : pending}
                      {run.cached ? <small>{t("bench.asr.cached")}</small> : run.download ? <small>{t("bench.asr.withDownload", { s: sec(run.download) })}</small> : null}
                    </td>
                    <td>{run.ms[0] !== undefined ? `${sec(run.ms[0])} s` : pending}</td>
                    <td>{run.ms[1] !== undefined ? `${sec(run.ms[1])} s` : pending}</td>
                    <td>{x !== null ? `${x.toFixed(2)}×` : pending}</td>
                    <td>{run.cer !== null ? `${(run.cer * 100).toFixed(1)}%` : pending}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="hint">{t("bench.asr.tableHint")}</p>
        </div>
      ) : null}
    </section>
  );
}

// 複製的結果：毫秒取整數。辨識出來的文字不放進去，只放字錯率
export function asrReport(runs: AsrRun[]) {
  return runs.map(({ id: _, load, ms, cer, ...run }) => ({
    ...run,
    dir: MODELS[run.model].dir,
    dtype: run.device === "webgpu" ? MODELS[run.model].webgpu.dtype : MODELS[run.model].dtype,
    seconds: ASR_SAMPLE.seconds,
    load: load === null ? null : Math.round(load),
    ms: ms.map(Math.round),
    cer: cer === null ? null : Math.round(cer * 1000) / 1000,
  }));
}

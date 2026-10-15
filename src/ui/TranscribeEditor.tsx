import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import {
  MAX_SECONDS,
  MODELS,
  MODEL_IDS,
  type ModelId,
  SAMPLE_RATE,
  type Segment,
  cleanSegments,
  clock,
  toSrt,
  toTxt,
} from "../tools/transcribe/segments.ts";
import type { Reply, Request } from "./transcribe.worker.ts";
import type { FileEditorProps } from "./types.ts";

// 逐字稿：把錄音或影片的聲音轉成帶時間的段落。解碼在這裡（Web Audio 只能在主執行緒用），
// 辨識在 Web Worker（src/ui/transcribe.worker.ts）。結果不是錄音的新版本，TXT 與 SRT
// 另外放進暫存區或直接下載。

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;
const MODEL_CACHE = "gears-models";
const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
const modelUrl = (id: ModelId) => `${BASE}models/whisper/${MODELS[id].dir}/`;

// 同時使用的 CPU 核心數，讀者自己選。預設 4 個，但不超過瀏覽器回報的核心數。Brave 的防指紋
// 保護會讓回報的數字比實際少，所以選項不依它限制。多執行緒要頁面在 cross-origin isolation
// 底下，沒有時只能用 1 個
const THREADS = [1, 2, 4, 8];
const ISOLATED = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
const DEFAULT_THREADS = ISOLATED ? Math.min(4, navigator.hardwareConcurrency || 4) : 1;

// 解碼並轉成 16 kHz 單聲道。OfflineAudioContext 解碼時會順便換成它的取樣率，不需要音訊裝置
async function decode(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i]! += data[i]! / buffer.numberOfChannels;
  }
  return out;
}

// 模型有沒有存在這台裝置的瀏覽器裡（service worker 的快取）
async function isDownloaded(id: ModelId): Promise<boolean> {
  if (!("caches" in self)) return false;
  const cache = await caches.open(MODEL_CACHE);
  return !!(await cache.match(`${modelUrl(id)}onnx/decoder_model_merged_quantized.onnx`));
}

async function removeModel(id: ModelId) {
  const cache = await caches.open(MODEL_CACHE);
  for (const request of await cache.keys()) if (request.url.startsWith(modelUrl(id))) await cache.delete(request);
}

type Phase =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "download"; loaded: number; total: number }
  | { kind: "recognize"; done: number; total: number; since: number }
  | { kind: "done" }
  | { kind: "failed" | "decodeFailed" | "tooLong" };

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TranscribeEditor({ blob, onCancel }: FileEditorProps) {
  const [model, setModel] = useState<ModelId>("small");
  const [language, setLanguage] = useState<"zh" | "auto">("zh");
  const [threads, setThreads] = useState(THREADS.includes(DEFAULT_THREADS) ? DEFAULT_THREADS : 2);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [downloaded, setDownloaded] = useState<Partial<Record<ModelId, boolean>>>({});
  const [note, setNote] = useState<string>("");
  const worker = useRef<{ instance: Worker; threads: number } | null>(null);

  const refresh = () => {
    for (const id of MODEL_IDS) void isDownloaded(id).then((yes) => setDownloaded((d) => ({ ...d, [id]: yes })));
  };
  useEffect(() => {
    refresh();
    return () => worker.current?.instance.terminate();
  }, []);

  const busy = phase.kind === "decoding" || phase.kind === "download" || phase.kind === "recognize";

  const stop = () => {
    worker.current?.instance.terminate();
    worker.current = null;
    setPhase({ kind: "idle" });
  };

  const start = async () => {
    setSegments([]);
    setNote("");
    setPhase({ kind: "decoding" });
    let audio: Float32Array;
    try {
      audio = await decode(blob);
    } catch {
      setPhase({ kind: "decodeFailed" });
      return;
    }
    if (audio.length / SAMPLE_RATE > MAX_SECONDS) {
      setPhase({ kind: "tooLong" });
      return;
    }
    // 同一個 Worker 留著用，換模型時由 Worker 放掉舊的。換核心數要換新的 Worker
    if (worker.current && worker.current.threads !== threads) {
      worker.current.instance.terminate();
      worker.current = null;
    }
    worker.current ??= { instance: new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" }), threads };
    const instance = worker.current.instance;
    const reference = audio.slice();
    instance.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.type === "download") setPhase({ kind: "download", loaded: reply.loaded, total: reply.total });
      else if (reply.type === "recognize")
        setPhase((p) => ({ kind: "recognize", done: reply.done, total: reply.total, since: p.kind === "recognize" ? p.since : Date.now() }));
      else if (reply.type === "result") {
        setSegments(cleanSegments(reply.chunks, reference));
        setPhase({ kind: "done" });
        refresh();
      } else {
        // 只有錯誤訊息，不含錄音的內容，讀者回報問題時用得到
        console.warn("[gears] 逐字稿失敗：", reply.message);
        setPhase({ kind: "failed" });
      }
    };
    instance.onerror = (event) => {
      console.warn("[gears] 逐字稿失敗：", event.message);
      setPhase({ kind: "failed" });
    };
    const request: Request = { type: "run", model, audio, language: language === "zh" ? "zh" : null, base: BASE, threads };
    instance.postMessage(request, [audio.buffer]);
  };

  const status = (() => {
    // 複製、刪除模型這類操作的結果優先顯示
    if (note && !busy) return note;
    switch (phase.kind) {
      case "decoding":
        return t("transcribe.decoding");
      case "download":
        return t("transcribe.downloading", { loaded: mb(phase.loaded), total: mb(phase.total) });
      case "recognize": {
        const left = phase.done ? ((Date.now() - phase.since) / phase.done) * (phase.total - phase.done) : 0;
        const text = t("transcribe.recognizing", { done: phase.done, total: phase.total });
        return left ? `${text}${t("transcribe.eta", { time: clock(left / 1000) })}` : text;
      }
      case "done":
        return segments.length ? t("transcribe.done", { n: segments.length }) : t("transcribe.empty");
      case "failed":
        return t("transcribe.failed");
      case "decodeFailed":
        return t("transcribe.decodeFailed");
      case "tooLong":
        return t("transcribe.tooLong");
      default:
        return "";
    }
  })();
  const progress = phase.kind === "download" ? phase.loaded / phase.total : phase.kind === "recognize" ? phase.done / phase.total : null;
  const error = phase.kind === "failed" || phase.kind === "decodeFailed" || phase.kind === "tooLong";

  return (
    <div class="transcribe">
      <p class="hint">{t("transcribe.note")}</p>
      <fieldset class="choices" disabled={busy}>
        <legend>{t("transcribe.model")}</legend>
        {MODEL_IDS.map((id) => (
          <label key={id} class="check">
            <input type="radio" name="transcribe-model" checked={model === id} onChange={() => setModel(id)} />
            <span>
              {t(`transcribe.model.${id}`)}
              {downloaded[id] ? <em class="badge done">{t("transcribe.downloaded")}</em> : null}
              <small>{t(`transcribe.model.${id}.desc`, { size: mb(MODELS[id].bytes) })}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {!downloaded[model] ? <p class="hint">{t("transcribe.firstTime")}</p> : null}
      <fieldset class="segmented" disabled={busy}>
        <legend>{t("transcribe.language")}</legend>
        {(["zh", "auto"] as const).map((id) => (
          <label key={id}>
            <input type="radio" name="transcribe-language" checked={language === id} onChange={() => setLanguage(id)} />
            <span>{t(`transcribe.language.${id}`)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset class="segmented" disabled={busy || !ISOLATED}>
        <legend>{t("transcribe.threads")}</legend>
        {THREADS.map((n) => (
          <label key={n}>
            <input type="radio" name="transcribe-threads" checked={threads === n} onChange={() => setThreads(n)} />
            <span>{n}</span>
          </label>
        ))}
      </fieldset>
      <p class="hint">{ISOLATED ? t("transcribe.threads.note") : t("transcribe.threads.single")}</p>

      <div class="buttons">
        {busy ? (
          <button type="button" onClick={stop}>
            {t("transcribe.stop")}
          </button>
        ) : (
          <button type="button" class="primary" onClick={start}>
            {phase.kind === "done" ? t("tool.transcribe.again") : t("transcribe.start")}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy}>
          {t("redact.cancel")}
        </button>
      </div>

      <p class={error ? "error" : "hint"} role="status" data-testid="transcribe-status">
        {status}
      </p>
      {busy ? (
        <div class="transcribe-progress">
          <div class="auto-progress-track" role="progressbar" aria-label={t("tool.transcribe")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}>
            <div class={progress === null ? "auto-progress-bar indeterminate" : "auto-progress-bar"} style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {segments.length ? (
        <>
          <ol class="transcript" data-testid="transcript">
            {segments.map((seg) => (
              <li key={seg.start}>
                <span class="time">{clock(seg.start)}</span>
                <span>{seg.text}</span>
              </li>
            ))}
          </ol>
          <div class="buttons">
            <button type="button" class="primary" onClick={() => download(toTxt(segments), "transcript.txt")}>
              {t("transcribe.downloadTxt")}
            </button>
            <button type="button" onClick={() => download(toSrt(segments), "transcript.srt")}>
              {t("transcribe.downloadSrt")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(toTxt(segments)).then(() => setNote(t("transcribe.copied")));
              }}
            >
              {t("transcribe.copy")}
            </button>
            <button
              type="button"
              onClick={() =>
                void tray.add(
                  [new File([toTxt(segments)], "transcript.txt", { type: "text/plain" }), new File([toSrt(segments)], "transcript.srt", { type: "text/plain" })],
                  "transcribe",
                )
              }
            >
              {t("transcribe.toTray")}
            </button>
          </div>
        </>
      ) : null}

      {downloaded[model] && !busy ? (
        <p class="hint">
          <button
            type="button"
            class="link"
            onClick={() => {
              void removeModel(model).then(() => {
                refresh();
                setNote(t("transcribe.modelRemoved"));
              });
            }}
          >
            {t("transcribe.removeModel", { size: mb(MODELS[model].bytes) })}
          </button>
        </p>
      ) : null}
    </div>
  );
}

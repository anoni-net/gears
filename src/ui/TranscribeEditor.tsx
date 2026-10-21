import { useEffect, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { MODELS, MODEL_IDS, type ModelId, SAMPLE_RATE, type Segment, clock, mergeSegments, toSrt, toTxt } from "../tools/transcribe/segments.ts";
import { type Device, type GpuInfo, gpuUsable } from "../tools/transcribe/device.ts";
import { LANGUAGES, type Language, modelsFor, preferredModel } from "../tools/transcribe/languages.ts";
import { ASSETS_MODELS, type Part, REMOTE_ERROR, isCached, partName, removeCached } from "../core/models.ts";
import { IS_ONION } from "../site.ts";
import speakerModel from "../tools/transcribe/speaker-model.json" with { type: "json" };
import { navigate } from "../router.ts";
import { THREAD_OPTIONS, defaultThreads } from "../tools/transcribe/threads.ts";
import { type AudioStream, TooLargeError, openAudio } from "./audio-stream.ts";
import { detectGpu } from "./gpu.ts";
import { wasmAvailable } from "./wasm.ts";
import type { Reply, Request } from "./transcribe.worker.ts";
import sherpaWorkerUrl from "./sherpa.worker.ts?worker&url";
import workerUrl from "./transcribe.worker.ts?worker&url";
import type { FileEditorProps } from "./types.ts";
import { track, trackFail } from "./analytics.ts";
import { useWorking } from "./working.ts";

// 逐字稿：把錄音或影片的聲音轉成帶時間的段落。解碼在這裡（Web Audio 只能在主執行緒用），
// 每次約 10 分鐘（src/ui/audio-stream.ts），辨識在 Web Worker（src/ui/transcribe.worker.ts），
// 處理完一段才解碼下一段，轉好的段落邊轉邊顯示。結果不是錄音的新版本，TXT 與 SRT 另外
// 放進暫存區或直接下載。

const BASE = new URL(import.meta.env.BASE_URL, location.href).href;
// 每次建立 Worker 都加上不同的查詢字串：WebKit 第二次用同一個網址建立 Worker 時，會被
// Cross-Origin-Embedder-Policy 擋下（換核心數、顯示卡失敗改用 CPU 都要換 Worker）
let workers = 0;
// 模型下載完之後，推論環境多久沒建好就停下來。Firefox 在記憶體很緊時（例如收掉舊的 Worker 之後
// 共享記憶體還沒釋放）會停在這裡，不會報錯
const STALL_MS = 180_000;
const STALLED = "stalled";

// Whisper 等 Transformers.js 的模型用 transcribe.worker，Omnilingual 用 sherpa.worker
// （models.json 的 engine），兩個 Worker 的訊息格式相同
type Engine = "transformers" | "sherpa";
const engineOf = (id: ModelId) => MODELS[id].engine as Engine;
const newWorker = (engine: Engine) => new Worker(`${engine === "sherpa" ? sherpaWorkerUrl : workerUrl}?n=${++workers}`, { type: "module" });
// 超過 1 GB 的寫成 1.6 GB，比 1561 MB 好讀
const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);
const modelUrl = (id: ModelId) => `${BASE}models/whisper/${MODELS[id].dir}/`;
// 每種裝置用的模型檔與大小（src/tools/transcribe/device.ts）
const modelFiles = (id: ModelId, device: Device) => (device === "webgpu" ? MODELS[id].webgpu.files : MODELS[id].files);
const modelBytes = (id: ModelId, device: Device) => (device === "webgpu" ? MODELS[id].webgpu.bytes : MODELS[id].bytes);

// 同時使用的 CPU 核心數，讀者自己選，預設值的判斷見 src/tools/transcribe/threads.ts。
// 多執行緒要頁面在 cross-origin isolation 底下，沒有時只能用 1 個
const THREADS = THREAD_OPTIONS;
const ISOLATED = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
// 辨識全部靠 WebAssembly。瀏覽器關掉時（鎖定模式）打開就說明，開始的按鈕不能按（見 wasm.ts）
const NO_WASM = !wasmAvailable();
const FIREFOX = /Firefox\//.test(navigator.userAgent);
const DEFAULT_THREADS = ISOLATED
  ? defaultThreads({
      firefox: FIREFOX,
      reported: navigator.hardwareConcurrency || 0,
      brave: "brave" in navigator,
      // Safari 的 UA 有 Safari 沒有 Chrome；iPad 的 Safari 偽裝成 Mac，用觸控點數分辨
      safari: /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent),
      mobileApple: /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    })
  : 1;

// 模型有沒有存在這台裝置的瀏覽器裡（service worker 的快取，大模型由 Worker 存進同一個快取）。
// 看那個裝置用的最後一個檔案，解碼器最後才下載
function isDownloaded(id: ModelId, device: Device): Promise<boolean> {
  const file = Object.keys(modelFiles(id, device)).at(-1)!;
  // 切成好幾段的檔案看最後一段（src/core/models.ts）
  const parts = (MODELS[id] as { parts?: Record<string, Part[]> }).parts?.[file];
  return isCached(`${modelUrl(id)}${parts ? partName(file, parts.length - 1) : file}`);
}

const removeModel = (id: ModelId) => removeCached(modelUrl(id));

type Phase =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "download"; loaded: number; total: number }
  | { kind: "recognize"; at: number; duration: number; since: number }
  | { kind: "done" }
  | { kind: "failed" | "remoteFailed" | "stalled" | "decodeFailed" | "tooLong" };

function download(text: string, name: string) {
  track("save", { how: "download" });
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TranscribeEditor({ blob, format, onCancel }: FileEditorProps) {
  const [model, setModel] = useState<ModelId>("small");
  const [language, setLanguage] = useState<Language>("zh");
  const [speakers, setSpeakers] = useState(false);
  // 顯示卡：undefined 是還在問瀏覽器，null 是不能用
  const [gpu, setGpu] = useState<GpuInfo | null | undefined>(undefined);
  const [useGpu, setUseGpu] = useState(true);
  // 這次實際用的裝置，WebGPU 失敗改用 CPU 時畫面上說明
  const [running, setRunning] = useState<{ requested: Device; actual: Device } | null>(null);
  const [threads, setThreads] = useState(DEFAULT_THREADS);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [segments, setSegments] = useState<Segment[]>([]);
  const [downloaded, setDownloaded] = useState<Partial<Record<ModelId, boolean>>>({});
  const [note, setNote] = useState<string>("");
  const worker = useRef<{ instance: Worker; threads: number; device: Device; engine: Engine } | null>(null);
  // 每次開始轉換加一，按下停止之後，舊的那一次收到的回覆不再處理
  const run = useRef(0);

  // sherpa-onnx 的模型只能用 CPU 的 1 個核心，不出現顯示卡、分辨說話者與核心數的選項
  const sherpa = engineOf(model) === "sherpa";
  const gpuChoice = (id: ModelId) => engineOf(id) === "transformers" && gpuUsable(gpu ?? null, MODELS[id].webgpu.buffer);
  const deviceFor = (id: ModelId): Device => (useGpu && gpuChoice(id) ? "webgpu" : "wasm");
  const device = deviceFor(model);
  const refresh = () => {
    for (const id of MODEL_IDS) void isDownloaded(id, deviceFor(id)).then((yes) => setDownloaded((d) => ({ ...d, [id]: yes })));
  };
  useEffect(() => {
    void detectGpu().then(setGpu);
    return () => worker.current?.instance.terminate();
  }, []);
  // 換裝置時要下載的檔案不同，重新看哪些已經下載
  useEffect(refresh, [gpu, useGpu]);

  const busy = phase.kind === "decoding" || phase.kind === "download" || phase.kind === "recognize";
  useWorking(busy);

  const stop = () => {
    run.current++;
    worker.current?.instance.terminate();
    worker.current = null;
    setPhase({ kind: "idle" });
  };

  const start = async () => {
    const id = ++run.current;
    setRunning(null);
    setSegments([]);
    setNote("");
    setPhase({ kind: "decoding" });
    let stream: AudioStream;
    let chunk: Float32Array | null;
    try {
      stream = await openAudio(blob, format);
      chunk = await stream.next();
    } catch (error) {
      setPhase({ kind: error instanceof TooLargeError ? "tooLong" : "decodeFailed" });
      trackFail("transcribe", error instanceof TooLargeError ? "too-large" : "unsupported");
      return;
    }
    // 這次用的裝置，Worker 拿不到顯示卡或顯示卡失敗時改成 wasm
    let current: Device = device;
    let fellBack = false;
    let stall: ReturnType<typeof setTimeout> | undefined;
    // 送出一個要求，等到指定的回覆
    let instance!: Worker;
    let waiting: { type: Reply["type"]; resolve(): void; reject(error: Error): void } | null = null;
    const send = (request: Request, until: Reply["type"], transfer: Transferable[] = []) =>
      new Promise<void>((resolve, reject) => {
        waiting = { type: until, resolve, reject };
        instance.postMessage(request, transfer);
      });
    const onReply = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (run.current !== id) return;
      if (reply.type === "download" && reply.loaded >= reply.total && !stall)
        stall = setTimeout(() => {
          worker.current?.instance.terminate();
          worker.current = null;
          waiting?.reject(new Error(STALLED));
        }, STALL_MS);
      if (reply.type === "ready") clearTimeout(stall);
      if (reply.type === "device") {
        current = reply.device;
        setRunning({ requested: device, actual: reply.device });
      } else if (reply.type === "download") setPhase({ kind: "download", loaded: reply.loaded, total: reply.total });
      else if (reply.type === "progress")
        setPhase((p) => ({ kind: "recognize", at: reply.at, duration: stream.duration, since: p.kind === "recognize" ? p.since : Date.now() }));
      else if (reply.type === "segments") setSegments((list) => mergeSegments([...list, ...reply.segments]));
      else if (reply.type === "speakers") {
        // 接縫上合併的段落留著第一段的開始時間，用它對回去
        const byStart = new Map(reply.speakers.map((s) => [s.start, s.speaker]));
        setSegments((list) => list.map((seg) => ({ ...seg, speaker: byStart.get(seg.start) })));
      } else if (reply.type === "error") {
        // 只有錯誤訊息，不含錄音的內容，讀者回報問題時用得到
        console.warn("[gears] 逐字稿失敗：", reply.message);
        waiting?.reject(new Error(reply.message));
      } else if (waiting?.type === reply.type) waiting.resolve();
    };
    // 同一個 Worker 留著用，換模型時由 Worker 放掉舊的。換核心數或裝置要換新的 Worker
    const boot = async () => {
      const engine = engineOf(model);
      if (worker.current && (worker.current.threads !== threads || worker.current.device !== current || worker.current.engine !== engine)) {
        worker.current.instance.terminate();
        worker.current = null;
      }
      worker.current ??= { instance: newWorker(engine), threads, device: current, engine };
      instance = worker.current.instance;
      instance.onmessage = onReply;
      instance.onerror = (event) => {
        console.warn("[gears] 逐字稿失敗：", event.message);
        waiting?.reject(new Error(event.message));
      };
      setRunning({ requested: device, actual: current });
      await send({ type: "start", model, language, base: BASE, threads, speakers: speakers && !sherpa, device: current }, "ready");
    };
    // 顯示卡建立推論環境或辨識失敗時，換一個新的 Worker 改用 CPU：onnxruntime 在一個 Worker 裡
    // 只初始化一次，WebGPU 初始化失敗之後，改要 CPU 也拿到同一個失敗。辨識到一半才失敗時，從失敗
    // 的那一段重新送，上一段留著接下來的那句話、分辨說話者已經算好的聲紋會遺失
    const gpuFailed = (error: unknown) => current === "webgpu" && !String(error).includes(REMOTE_ERROR);
    const fallback = async (error: unknown) => {
      console.warn("[gears] 顯示卡失敗，改用 CPU：", String(error));
      current = "wasm";
      fellBack = true;
      // CPU 用的模型重新下載，逾時從下載完重新算
      clearTimeout(stall);
      stall = undefined;
      worker.current?.instance.terminate();
      worker.current = null;
      await boot();
    };
    try {
      await boot().catch(async (error: unknown) => {
        if (!gpuFailed(error)) throw error;
        await fallback(error);
      });
      setPhase({ kind: "recognize", at: 0, duration: stream.duration, since: Date.now() });
      let offset = 0;
      while (chunk) {
        const seconds = chunk.length / SAMPLE_RATE;
        // 用顯示卡時送一份複本，失敗時才有原本的那段可以重送
        const audio = current === "webgpu" ? chunk.slice() : chunk;
        try {
          await send({ type: "chunk", audio, offset, last: false }, "done", [audio.buffer]);
        } catch (error) {
          if (!gpuFailed(error)) throw error;
          await fallback(error);
          await send({ type: "chunk", audio: chunk, offset, last: false }, "done", [chunk.buffer]);
        }
        if (run.current !== id) return;
        offset += seconds;
        chunk = await stream.next();
      }
      // 最後送一段空的，把留著接下一段的那句話辨識完
      await send({ type: "chunk", audio: new Float32Array(0), offset, last: true }, "done");
      if (run.current !== id) return;
      setPhase({ kind: "done" });
      refresh();
      // 用了哪個模型、CPU 還是顯示卡、顯示卡有沒有失敗退回 CPU
      track("transcribe", { model, device: current === "webgpu" ? "gpu" : "cpu", fallback: fellBack ? "1" : "0" });
      track("tool-done", { tool: "transcribe" });
    } catch (error) {
      clearTimeout(stall);
      if (run.current !== id) return;
      const remote = String(error).includes(REMOTE_ERROR);
      const stalled = String(error).includes(STALLED);
      setPhase({ kind: remote ? "remoteFailed" : stalled ? "stalled" : "failed" });
      trackFail("transcribe", remote ? "network" : stalled ? "stalled" : "other");
    }
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
        const left = phase.at ? ((Date.now() - phase.since) / phase.at) * (phase.duration - phase.at) : 0;
        const text = t("transcribe.recognizing", { at: clock(phase.at), total: clock(phase.duration) });
        return left ? `${text}${t("transcribe.eta", { time: clock(left / 1000) })}` : text;
      }
      case "done": {
        if (!segments.length) return t("transcribe.empty");
        const people = new Set(segments.flatMap((seg) => (seg.speaker === undefined ? [] : [seg.speaker]))).size;
        return people ? t("transcribe.doneSpeakers", { n: segments.length, speakers: people }) : t("transcribe.done", { n: segments.length });
      }
      case "failed":
        return t("transcribe.failed");
      case "remoteFailed":
        return t("transcribe.remoteFailed");
      case "stalled":
        return t("transcribe.stalled");
      case "decodeFailed":
        return t("transcribe.decodeFailed");
      case "tooLong":
        return t("transcribe.tooLong");
      default:
        return "";
    }
  })();
  const progress = phase.kind === "download" ? phase.loaded / phase.total : phase.kind === "recognize" ? Math.min(1, phase.at / phase.duration) : null;
  const speakerName = (n: number) => t("transcribe.speakerPrefix", { n: n + 1 });
  const error = phase.kind === "failed" || phase.kind === "remoteFailed" || phase.kind === "stalled" || phase.kind === "decodeFailed" || phase.kind === "tooLong";
  // 從 Hugging Face 下載的模型，還沒下載時先說明會連到哪裡、送出什麼，按鈕上也寫明。
  // assets.anoni.net 是社群自己的網域，不另外說明
  const remote = MODELS[model].host === "hf" && !downloaded[model];
  // 先選語言，再列出這個語言能用的模型（src/tools/transcribe/languages.ts），換語言時回到
  // 這個語言預設的模型
  const chooseLanguage = (id: Language) => {
    setLanguage(id);
    setModel(preferredModel(id));
  };

  return (
    <div class="transcribe">
      <p class="hint">{t("transcribe.note")}</p>
      <fieldset class="segmented" disabled={busy}>
        <legend>{t("transcribe.language")}</legend>
        {LANGUAGES.map((id) => (
          <label key={id}>
            <input type="radio" name="transcribe-language" checked={language === id} onChange={() => chooseLanguage(id)} />
            <span>{t(`transcribe.language.${id}`)}</span>
          </label>
        ))}
      </fieldset>
      <p class="hint">{t("transcribe.language.note")}</p>
      {language === "yue" ? (
        <p class="hint" data-testid="transcribe-yue">
          {t("transcribe.language.yue.note")}
        </p>
      ) : null}
      <fieldset class="choices" disabled={busy}>
        <legend>{t("transcribe.model")}</legend>
        {modelsFor(language).map((id) => (
          <label key={id} class="check">
            <input type="radio" name="transcribe-model" checked={model === id} onChange={() => setModel(id)} />
            <span>
              {t(`transcribe.model.${id}`)}
              {downloaded[id] ? <em class="badge done">{t("transcribe.downloaded")}</em> : null}
              <small>{t(`transcribe.model.${id}.desc`, { size: mb(modelBytes(id, deviceFor(id))) })}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {remote ? (
        <p class="notice" data-testid="transcribe-remote">
          {t("transcribe.remote.note")}
        </p>
      ) : !downloaded[model] ? (
        <p class="hint">{t("transcribe.firstTime")}</p>
      ) : null}

      {gpuChoice(model) ? (
        <label class="check">
          <input type="checkbox" checked={useGpu} disabled={busy} onChange={(e) => setUseGpu(e.currentTarget.checked)} />
          <span>
            {t("transcribe.gpu")}
            <small>{t("transcribe.gpu.desc")}</small>
          </span>
        </label>
      ) : null}
      {sherpa ? (
        <p class="hint" data-testid="transcribe-sherpa">
          {t("transcribe.sherpa.note")}
        </p>
      ) : (
        <>
          <label class="check">
            <input type="checkbox" checked={speakers} disabled={busy} onChange={(e) => setSpeakers(e.currentTarget.checked)} />
            <span>
              {t("transcribe.speakers")}
              <small>{t("transcribe.speakers.desc", { size: mb(speakerModel.bytes) })}</small>
            </span>
          </label>

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
          {ISOLATED && FIREFOX ? <p class="hint">{t("transcribe.threads.firefox")}</p> : null}
        </>
      )}

      {NO_WASM ? (
        <p class="error" role="alert" data-testid="transcribe-nowasm">
          {t("wasm.transcribe")}
        </p>
      ) : null}
      <div class="buttons">
        {busy ? (
          <button type="button" onClick={stop}>
            {t("transcribe.stop")}
          </button>
        ) : (
          <button type="button" class="primary" disabled={NO_WASM} onClick={start}>
            {remote ? t("transcribe.remote.start") : phase.kind === "done" ? t("tool.transcribe.again") : t("transcribe.start")}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy}>
          {t("redact.cancel")}
        </button>
      </div>

      <p class={error ? "error" : "hint"} role="status" data-testid="transcribe-status">
        {status}
      </p>
      {running?.requested === "webgpu" && (busy || phase.kind === "done") ? (
        <p class="hint" data-testid="transcribe-device">
          {running.actual === "webgpu" ? t("transcribe.device.gpu") : t("transcribe.device.fallback")}
        </p>
      ) : null}
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
            {segments.map((seg, i) => (
              <li key={seg.start}>
                <span class="time">{clock(seg.start)}</span>
                <span>
                  {/* 換人的地方才標出說話者 */}
                  {seg.speaker !== undefined && seg.speaker !== segments[i - 1]?.speaker ? <strong class="speaker">{t("transcribe.speaker", { n: seg.speaker + 1 })}</strong> : null}
                  {seg.text}
                </span>
              </li>
            ))}
          </ol>
          <div class="buttons">
            <button type="button" class="primary" onClick={() => download(toTxt(segments, speakerName), "transcript.txt")}>
              {t("transcribe.downloadTxt")}
            </button>
            <button type="button" onClick={() => download(toSrt(segments, speakerName), "transcript.srt")}>
              {t("transcribe.downloadSrt")}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(toTxt(segments, speakerName)).then(() => setNote(t("transcribe.copied")));
              }}
            >
              {t("transcribe.copy")}
            </button>
            <button
              type="button"
              onClick={() =>
                void tray.add(
                  [new File([toTxt(segments, speakerName)], "transcript.txt", { type: "text/plain" }), new File([toSrt(segments, speakerName)], "transcript.srt", { type: "text/plain" })],
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
                setNote(t("transcribe.modelRemoved", { model }));
              });
            }}
          >
            {/* 只刪目前選取的模型，按鈕上寫出是哪一個 */}
            {t("transcribe.removeModel", { model, size: mb(modelBytes(model, device)) })}
          </button>
        </p>
      ) : null}

      {/* 每個模型分三行寫：原始模型與授權、ONNX 檔是誰轉的、從哪裡下載，從 models.json 讀，授權全文在授權頁。
          repo 跟原始模型是同一個時，代表是社群拿原始模型自己轉檔，連到 assets.anoni.net 那個目錄的 README.txt */}
      <details class="transcribe-models" data-testid="transcribe-models">
        <summary>{t("transcribe.models.title")}</summary>
        <ul>
          {[
            ...MODEL_IDS.map((id) => {
              const { source, license, repo, host, dir } = MODELS[id];
              const ours = repo === new URL(source).pathname.slice(1);
              return {
                id: id as string,
                name: tDynamic(`transcribe.model.${id}`),
                source,
                label: new URL(source).pathname.slice(1),
                license,
                host,
                convert: ours
                  ? { notes: `${ASSETS_MODELS}${dir}/README.txt` }
                  : { url: `https://huggingface.co/${repo}`, label: repo },
              };
            }),
            {
              id: "speaker",
              name: t("transcribe.speakers"),
              source: speakerModel.source,
              label: "3D-Speaker CAM++",
              license: speakerModel.license,
              host: "self",
              convert: { url: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models", label: "sherpa-onnx" },
            },
          ].map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              <span>
                {t("transcribe.models.source")}
                <a href={m.source} target="_blank" rel="noopener">
                  {m.label}
                </a>
                {t("transcribe.models.licensed", { license: m.license })}
              </span>
              <span>
                {t("transcribe.models.convert")}
                {"url" in m.convert ? (
                  <>
                    <a href={m.convert.url} target="_blank" rel="noopener">
                      {m.convert.label}
                    </a>
                    {t("transcribe.models.convertCopy")}
                  </>
                ) : (
                  <>
                    {t("transcribe.models.convertOurs")}
                    <a href={m.convert.notes} target="_blank" rel="noopener">
                      {t("transcribe.models.convertNotes")}
                    </a>
                  </>
                )}
              </span>
              <span>
                {t("transcribe.models.download")}
                {tDynamic(`transcribe.models.host.${IS_ONION && m.host === "assets" ? "self" : m.host}`)}
              </span>
            </li>
          ))}
        </ul>
        <p class="hint">
          <button type="button" class="link" onClick={() => navigate("licenses")}>
            {t("transcribe.models.all")}
          </button>
        </p>
      </details>
    </div>
  );
}

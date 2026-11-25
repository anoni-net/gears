import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { MODELS, MODEL_IDS, type ModelId, SAMPLE_RATE, type Segment, clock, mergeSegments, toSrt, toTxt } from "../tools/transcribe/segments.ts";
import { replaceInParts } from "../tools/writing-style/index.ts";
import { AliasForm, aliasMessage, allAliases } from "./AliasForm.tsx";
import { StyleModel } from "./StyleModel.tsx";
import { type Device, type GpuInfo, gpuUsable } from "../tools/transcribe/device.ts";
import { LANGUAGES, type Language, modelsFor, preferredModel } from "../tools/transcribe/languages.ts";
import { type Insert, PUNCT_MB, PUNCT_MODEL, applyInserts, punctAvailable, splitForDisplay } from "../tools/transcribe/punct.ts";
import { ASSETS_MODELS, type Part, REMOTE_ERROR, isCached, partName, removeCached } from "../core/models.ts";
import { IS_ONION } from "../site.ts";
import speakerModel from "../tools/transcribe/speaker-model.json" with { type: "json" };
import vadModel from "../tools/transcribe/vad-model.json" with { type: "json" };
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { THREAD_OPTIONS } from "../tools/transcribe/threads.ts";
import { DEFAULT_THREADS, FIREFOX, ISOLATED } from "./thread-default.ts";
import { type AudioStream, TooLargeError, openAudio } from "./audio-stream.ts";
import { detectGpu } from "./gpu.ts";
import { wasmAvailable } from "./wasm.ts";
import { onPhone } from "./phone.ts";
import { CANCELLED, PunctDownloadError, type PunctProgress, punctCrashedBefore, punctRunner, punctStored } from "./punct-detect.ts";
import type { Reply, Request } from "./transcribe.worker.ts";
import sherpaWorkerUrl from "./sherpa.worker.ts?worker&url";
import workerUrl from "./transcribe.worker.ts?worker&url";
import type { FileEditorProps } from "./types.ts";
import { Icon } from "./Icon.tsx";
import { track, trackFail } from "./analytics.ts";
import { useWorking } from "./working.ts";
import { PrivacyLink } from "./PrivacyLink.tsx";
import { ProgressBar } from "./ProgressBar.tsx";

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
// 辨識全部靠 WebAssembly。瀏覽器關掉時（鎖定模式）打開就說明，開始的按鈕不能按（見 wasm.ts）
const NO_WASM = !wasmAvailable();

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

// 標點建議（src/ui/punct-detect.ts）：asking 是手機上按下之後先展開的確認說明，ready 是建議已經算好
type Punct =
  | { kind: "idle" | "asking" | "ready" | "none" | "discarded" | "failed" | "remoteFailed" }
  | { kind: "running"; progress: PunctProgress | null };

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
  // 自己指定要換掉的字與接受建議的標點：每次改之前的逐字稿，復原時一步一步退回。重新轉一次時清空
  const [history, setHistory] = useState<Segment[][]>([]);
  const [aliasNote, setAliasNote] = useState("");
  const [downloaded, setDownloaded] = useState<Partial<Record<ModelId, boolean>>>({});
  const [note, setNote] = useState<string>("");
  // 語音偵測用 Silero（true）或退回音量判斷（false），還沒載入時是 null。sherpa-onnx 的模型一律用音量判斷
  const [silero, setSilero] = useState<boolean | null>(null);
  // 這次送進模型的片段數，放在狀態那一行的 data-pieces，瀏覽器測試用來確認語音偵測的結果
  const [pieces, setPieces] = useState(0);
  const worker = useRef<{ instance: Worker; threads: number; device: Device; engine: Engine } | null>(null);
  // 這份逐字稿轉的時候用的語言與模型。轉完之後讀者還能改選項，標點建議看的是轉的時候
  const [doneWith, setDoneWith] = useState<{ language: Language; model: ModelId } | null>(null);
  // 標點建議：每一段的建議綁著算出它的那份文字，段落的文字換過（換掉的字、復原、接受）就不顯示，
  // 復原回同一份文字時建議又出現
  const [punct, setPunct] = useState<Punct>({ kind: "idle" });
  const [suggestions, setSuggestions] = useState<{ base: string; inserts: Insert[] }[] | null>(null);
  const runner = useMemo(() => punctRunner(), []);
  // 關掉逐字稿時停下進行中的那一次，sessionStorage 的記號跟著清掉，不會被當成記憶體不夠
  useEffect(() => () => runner.cancel(), [runner]);
  // 上一次補標點時頁面被重新載入了（多半是記憶體不夠），這個分頁不再提供
  const [punctCrashed] = useState(punctCrashedBefore);
  // 手機與平板上第一次按下時先展開說明（照遮蔽的 phoneAsk），手機上的下載量寫在說明裡
  const [phone] = useState(onPhone);
  const [phoneOk, setPhoneOk] = useState(() => !phone);
  // 標點模型還要下載多少 MB，已經在快取裡是 0，還在查是 null
  const [punctMb, setPunctMb] = useState<number | null>(null);
  useEffect(() => {
    void punctStored().then((stored) => setPunctMb(stored ? 0 : PUNCT_MB));
  }, []);
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
  const punctBusy = punct.kind === "running";
  useWorking(busy || punctBusy);

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
    setHistory([]);
    setAliasNote("");
    runner.cancel();
    setPunct({ kind: "idle" });
    setSuggestions(null);
    setDoneWith({ language, model });
    setNote("");
    setSilero(null);
    setPieces(0);
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
      else if (reply.type === "vad") setSilero(reply.silero);
      else if (reply.type === "segments") {
        setSegments((list) => mergeSegments([...list, ...reply.segments]));
        setPieces((n) => n + reply.pieces);
      }
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

  // 換上代稱：自行指定的表單與模型找到的清單共用，名字被切在兩段之間時換不到
  const replaceAlias = (word: string, alias: string) => {
    const result = replaceInParts(segments, word, alias, allAliases());
    if (result.count) {
      setHistory([...history, segments]);
      setSegments(result.parts);
    }
    setAliasNote(aliasMessage(word, alias, result.count));
  };

  // 標點建議：整份逐字稿交給標點模型，建議分回各段，讀者接受之後才換上
  const runPunct = async (confirmed = phoneOk) => {
    if (!confirmed) {
      setPunct({ kind: "asking" });
      return;
    }
    setPhoneOk(true);
    // 辨識用的 Worker 先結束，Whisper 與標點模型不同時佔著記憶體（Breeze 的模型超過 1 GB）。下次轉逐字稿時再從快取載入
    worker.current?.instance.terminate();
    worker.current = null;
    const texts = segments.map((seg) => seg.text);
    setPunct({ kind: "running", progress: null });
    try {
      const inserts = await runner.run(texts, (progress) => setPunct({ kind: "running", progress }));
      const found = inserts.map((list, i) => ({ base: texts[i]!, inserts: list }));
      setSuggestions(found);
      setPunct({ kind: found.some((s) => s.inserts.length) ? "ready" : "none" });
      // 模型已經存進快取，捨棄之後再按一次時不寫下載量
      setPunctMb(0);
    } catch (error) {
      if ((error as Error).message === CANCELLED) return;
      setPunct({ kind: error instanceof PunctDownloadError ? "remoteFailed" : "failed" });
    }
  };
  const stopPunct = () => {
    runner.cancel();
    setPunct({ kind: "idle" });
  };
  // 第 i 段還沒處理的建議：建議是從現在這份文字算出來的才算
  const pendingAt = (i: number) => {
    const s = suggestions?.[i];
    return s && s.inserts.length && s.base === segments[i]?.text ? s.inserts : null;
  };
  const pendingCount = segments.reduce((n, _, i) => n + (pendingAt(i) ? 1 : 0), 0);
  // 接受建議：跟換掉的字一樣記進復原的紀錄，只插入標點，時間與說話者不動
  const acceptPunct = (only?: number) => {
    setHistory([...history, segments]);
    setSegments(segments.map((seg, i) => {
      const inserts = (only === undefined || only === i) && pendingAt(i);
      return inserts ? { ...seg, text: applyInserts(seg.text, inserts) } : seg;
    }));
    setAliasNote("");
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
  // 標點建議的訊息
  const punctStatus = (() => {
    if (punct.kind === "running") {
      const p = punct.progress;
      if (!p) return t("transcribe.punct.loading");
      // 用百分比：讀到的位元組是解壓縮之後的（總量 176 MB），跟說明裡經過壓縮的下載量（約 148 MB）對不上
      if (p.kind === "download") return t("transcribe.punct.downloading", { percent: Math.round((p.loaded / p.total) * 100) });
      if (p.kind === "loading") return t("transcribe.punct.loading");
      return t("transcribe.punct.running", { percent: Math.round((p.done / p.total) * 100) });
    }
    if (pendingCount) return t("transcribe.punct.ready", { n: pendingCount });
    switch (punct.kind) {
      case "ready":
        return t("transcribe.punct.settled");
      case "none":
        return t("transcribe.punct.none");
      case "discarded":
        return t("transcribe.punct.discarded");
      case "failed":
        return t("transcribe.punct.failed");
      case "remoteFailed":
        return t("transcribe.punct.remoteFailed");
      default:
        return "";
    }
  })();
  const punctProgress = punct.kind === "running" && punct.progress && punct.progress.kind !== "loading" ? (punct.progress.kind === "download" ? punct.progress.loaded / punct.progress.total : punct.progress.done / punct.progress.total) : null;
  // 華語的逐字稿轉完之後才提供（範圍見 src/tools/transcribe/punct.ts 的 punctAvailable）
  const punctUsable = phase.kind === "done" && !busy && segments.length > 0 && !!doneWith && punctAvailable(doneWith.language, doneWith.model) && !punctCrashed;
  const punctCanStart = punct.kind === "idle" || punct.kind === "discarded" || punct.kind === "failed" || punct.kind === "remoteFailed";

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
      {/* 歌聲與背景音樂不會轉成文字：Silero VAD 把它們當成不是說話（src/tools/transcribe/segments.ts）。
          sherpa-onnx 的模型仍用音量判斷，不寫這一句 */}
      {sherpa ? null : (
        <p class="hint" data-testid="transcribe-vad-note">
          {t("transcribe.vad.note")}
        </p>
      )}
      {punctCrashed ? (
        <p class="callout" data-testid="punct-crashed">
          {t("transcribe.punct.crashed")}
        </p>
      ) : null}
      <fieldset class="segmented" disabled={busy || punctBusy}>
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
        <p class="callout" data-testid="transcribe-remote">
          {t("transcribe.remote.note")} <PrivacyLink section="models" label="common.privacyHf" />
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
      <div class="buttons action-bar">
        {busy ? (
          <button type="button" onClick={stop}>
            {t("transcribe.stop")}
          </button>
        ) : (
          <button type="button" class="primary" disabled={NO_WASM || punctBusy} onClick={start}>
            {remote ? t("transcribe.remote.start") : phase.kind === "done" ? t("tool.transcribe.again") : t("transcribe.start")}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>

      <p class={error ? "error" : "hint"} role="status" data-testid="transcribe-status" data-pieces={pieces}>
        {status}
      </p>
      {running?.requested === "webgpu" && (busy || phase.kind === "done") ? (
        <p class="hint" data-testid="transcribe-device">
          {running.actual === "webgpu" ? t("transcribe.device.gpu") : t("transcribe.device.fallback")}
        </p>
      ) : null}
      {silero === false && !sherpa && (busy || phase.kind === "done") ? (
        <p class="callout" data-testid="transcribe-vad">
          {t("transcribe.vad.fallback")}
        </p>
      ) : null}
      {busy ? (
        <div class="transcribe-progress">
          <ProgressBar label={t("tool.transcribe")} value={progress} />
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
                  {(() => {
                    // 建議的標點用另一種顏色加底線，讀螢幕軟體唸得到 title。接受之前下載與複製的都是原文
                    const inserts = pendingAt(i);
                    if (!inserts) return seg.text;
                    return (
                      <>
                        {splitForDisplay(seg.text, inserts).map((part, k) =>
                          part.suggested ? (
                            <ins key={k} class="punct-suggest" title={t("transcribe.punct.mark")}>
                              {part.text}
                            </ins>
                          ) : (
                            part.text
                          ),
                        )}{" "}
                        {busy ? null : (
                          <button type="button" class="link punct-accept" aria-label={t("transcribe.punct.acceptAt", { time: clock(seg.start) })} onClick={() => acceptPunct(i)}>
                            {t("transcribe.punct.acceptOne")}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </span>
              </li>
            ))}
          </ol>
          {punctUsable ? (
            <div class="transcribe-punct" data-testid="punct">
              {punctCanStart ? (
                <>
                  {/* 手機上的下載量寫在按下之後的說明裡，同一件事不寫兩次 */}
                  <p class="hint" data-testid="punct-note">
                    {!phone && punctMb ? t("transcribe.punct.note", { mb: punctMb }) : t("transcribe.punct.noteStored")}
                  </p>
                  <div class="buttons">
                    <button type="button" onClick={() => runPunct()}>
                      <span class="tool-tag" aria-hidden="true">
                        <Icon name="brain" />
                      </span>
                      {t("transcribe.punct.button")}
                    </button>
                  </div>
                </>
              ) : null}
              {punct.kind === "asking" ? (
                <div class="redact-model-ask" data-testid="punct-ask" role="group" aria-label={t("transcribe.punct.button")}>
                  <p>{t("transcribe.punct.phone", { mb: punctMb || PUNCT_MB })}</p>
                  <div class="buttons">
                    <button type="button" class="primary" onClick={() => runPunct(true)}>
                      {t("common.phoneGo")}
                    </button>
                    <a class="button" href={routeUrl("testing")} onClick={(e) => onRouteClick(e, () => navigate("testing"))}>
                      {t("common.phoneTest")}
                    </a>
                  </div>
                </div>
              ) : null}
              {punctStatus ? (
                <p class={punct.kind === "failed" || punct.kind === "remoteFailed" ? "error" : "hint"} role="status" data-testid="punct-status">
                  {punctStatus}
                </p>
              ) : null}
              {punctBusy ? (
                <>
                  <div class="transcribe-progress">
                    <ProgressBar label={t("transcribe.punct.button")} value={punctProgress} />
                  </div>
                  <div class="buttons">
                    <button type="button" onClick={stopPunct}>
                      {t("transcribe.stop")}
                    </button>
                  </div>
                </>
              ) : null}
              {pendingCount ? (
                <div class="buttons">
                  <button type="button" class="primary" onClick={() => acceptPunct()}>
                    {t("transcribe.punct.acceptAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSuggestions(null);
                      setPunct({ kind: "discarded" });
                    }}
                  >
                    {t("transcribe.punct.discard")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {!busy ? (
            <AliasForm
              id="transcribe-alias"
              text={segments.map((seg) => seg.text).join("\n")}
              hint={t("transcribe.alias.hint")}
              message={aliasNote}
              onReplace={replaceAlias}
            />
          ) : null}
          {/* 用個資辨識模型找人名、地址與單位（#143），逐項換成代稱，跟上面的表單同一套。每轉一次換一個元件，清單跟著清掉 */}
          {!busy && segments.length ? (
            <StyleModel
              key={run.current}
              id="transcribe-model"
              variant="transcript"
              text={segments.map((seg) => seg.text).join("\n")}
              keep={allAliases()}
              onReplace={replaceAlias}
              beforeRun={() => {
                // 辨識用的 Worker 先結束，Whisper 與個資辨識模型不同時佔著記憶體（同標點建議）
                worker.current?.instance.terminate();
                worker.current = null;
              }}
            />
          ) : null}
          {history.length && !busy ? (
            <div class="buttons">
              <button
                type="button"
                onClick={() => {
                  setSegments(history.at(-1)!);
                  setHistory(history.slice(0, -1));
                  setAliasNote(t("common.undone"));
                }}
              >
                {t("common.undo")}
              </button>
            </div>
          ) : null}
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
            {
              id: "punct",
              name: t("transcribe.punct.button"),
              source: PUNCT_MODEL.source,
              label: PUNCT_MODEL.repo,
              license: PUNCT_MODEL.license,
              host: "assets",
              // 社群把原始模型附的 ONNX 檔重新量化，轉檔紀錄是 assets.anoni.net 那個目錄的 README.txt
              convert: { notes: `${ASSETS_MODELS}${PUNCT_MODEL.dir}/README.txt`, ours: t("transcribe.models.convertPunct") },
            },
            {
              id: "vad",
              name: t("transcribe.vad.name"),
              source: vadModel.source,
              label: `Silero VAD ${vadModel.version}`,
              license: vadModel.license,
              host: "self",
              // 官方 repo 本身就附 ONNX 檔，原封不動使用
              convert: { url: `${vadModel.source}/tree/${vadModel.version}/src/silero_vad/data`, label: "snakers4/silero-vad" },
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
                    {"ours" in m.convert && m.convert.ours ? m.convert.ours : t("transcribe.models.convertOurs")}
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

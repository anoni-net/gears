import { useEffect, useRef, useState } from "preact/hooks";
import { list, t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import type { Box } from "../tools/redact/index.ts";
import type { LineText } from "../tools/redact/pii.ts";
import { PII_MB } from "../tools/redact/pii-model.ts";
import { type ScreenFound, foundAnything, modelCounts, modelOnly, piiCounts, screenBoxes, screenMaybe } from "../tools/redact/screen.ts";
import { callout } from "./callout.ts";
import { assertCanvasReadable, isCanvasBlocked } from "./canvas-access.ts";
import { CopyButton } from "./CopyButton.tsx";
import { Icon } from "./Icon.tsx";
import { OcrUrlList } from "./OcrUrlList.tsx";
import { type FoundUrl, ocrText, urlsInImage } from "./url-ocr.ts";
import { type DetectDownload, detectDownload } from "./detect-download.ts";
import { decodeImage } from "./image-decode.ts";
import { onPhone } from "./phone.ts";
import { type PiiDetector, crashedBefore, piiDetector } from "./pii-detect.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { wasmAvailable } from "./wasm.ts";
import { useWorking } from "./working.ts";

// 檔案畫面的「畫面上看得到的」：清除中繼資料不會改變畫面，照片裡的人臉與截圖上的電話仍然看得到。
// 讀者按下檢查才載入模型，找人臉與辨識文字跟遮蔽的自動尋找是同一套（src/ui/redact-detect.ts），
// 模型下載一次，兩邊共用 gears-keep 的快取。找到的框交給遮蔽放好，由讀者逐一確認，這裡不改檔案。
//
// 檔案畫面依版本建立這個元件（key 是版本的 id），換了版本（縮成常見尺寸、HEIC 轉 JPEG 這類會改像素的處理）
// 結果跟著清掉，框的座標不會套到另一個版本上
//
// 從「檢查收到的」那一組放進來的圖片（receiving，TrayFile.intent 是 check），另外列出畫面上的網址
// （跟網址檢查的「從截圖讀出網址」同一份列表，按「檢查這個網址」交給網址檢查）與「複製讀出的文字」。
// 交出去之前的照片只列數量，不列文字：看到內容、決定要不要遮的地方是遮蔽的畫面
//
// 人名、地址與單位用個資辨識模型（#187，src/ui/pii-detect.ts）：約 200 MB，不跟著「檢查畫面內容」一起下載，
// 檢查完、讀到文字之後才出現按鈕，讀者按下才下載。辨識文字讀出的每一行留在結果裡，不必重新辨識。
// 模型失敗不影響規則的結果，只在按鈕下面說明。上一次用模型時頁面被重新載入的記號跟遮蔽共用
// （同一個模型、同一台裝置），手機與平板第一次按下時先展開說明，照遮蔽的做法

type State =
  | { step: "idle" }
  | { step: "faces" | "text"; progress: number | null }
  | { step: "done"; found: ScreenFound; urls: FoundUrl[]; text: string; lines: LineText[]; width: number; height: number }
  | { step: "failed" | "blocked" | "noWasm" | "decodeFailed" };

type Model = { step: "idle" | "asking" | "failed" } | { step: "running"; progress: number | null } | { step: "done"; n: number };

interface Props {
  blob: Blob;
  busy?: boolean;
  // 遮蔽接受這個格式時才有「打開遮蔽」的按鈕（TIFF 這類遮蔽不收的照樣可以檢查）
  canRedact: boolean;
  onRedact(found: { boxes: Box[]; maybe: Box[] }): void;
  // 檢查收到的圖片：列出畫面上的網址與讀出的文字
  receiving?: boolean;
  onOpenTool(id: string, preset?: string): void;
}

export function ScreenCheck({ blob, busy, canRedact, onRedact, receiving = false, onOpenTool }: Props) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [download, setDownload] = useState<DetectDownload | null>(null);
  const [model, setModel] = useState<Model>({ step: "idle" });
  const [crashed] = useState(crashedBefore);
  // 手機上的下載量與記憶體提醒寫在按下之後的說明裡，按鈕上方的說明只給電腦
  const [phone] = useState(onPhone);
  const confirmed = useRef(!phone);
  // Worker 在第一次用到時才建立，按「停止」時結束、換一個新的
  const detector = useRef<PiiDetector | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void detectDownload().then((d) => alive.current && setDownload(d));
    return () => {
      alive.current = false;
      detector.current?.dispose();
    };
  }, []);
  const running = state.step === "faces" || state.step === "text";
  const modelRunning = model.step === "running";
  useWorking(running || modelRunning);

  const check = async () => {
    // 順序跟遮蔽的自動尋找一樣：先看 WebAssembly，再在點擊的當下讀一次 canvas（Tor Browser 這時才會在
    // 網址列跳出詢問），之後才解碼與下載模型，讀者不必等下載完才知道不能用
    if (!wasmAvailable()) return setState({ step: "noWasm" });
    try {
      assertCanvasReadable();
    } catch (error) {
      return setState({ step: isCanvasBlocked(error) ? "blocked" : "failed" });
    }
    setState({ step: "faces", progress: null });
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await decodeImage(blob).catch(() => null);
      if (!bitmap) {
        if (alive.current) setState({ step: "decodeFailed" });
        return;
      }
      const { findFaces, findText } = await import("./redact-detect.ts");
      const progress = (step: "faces" | "text") => (value: number | null) => alive.current && setState({ step, progress: value });
      // 一次只執行一個模型，手機上不會同時佔兩份記憶體
      const faces = await findFaces(bitmap, progress("faces"));
      const text = await findText(bitmap, progress("text"));
      // 裁切小圖在關掉圖片之前畫好
      const urls = receiving ? urlsInImage(bitmap, text.ocr) : [];
      const read = receiving ? ocrText(text.ocr) : "";
      if (alive.current)
        setState({
          step: "done",
          found: { faces: faces.faces, maybe: faces.maybe, pii: text.pii },
          urls,
          text: read,
          lines: text.texts,
          width: bitmap.width,
          height: bitmap.height,
        });
    } catch (error) {
      if (alive.current) setState({ step: isCanvasBlocked(error) ? "blocked" : "failed" });
    } finally {
      bitmap?.close();
    }
  };

  // 用個資辨識模型找人名、地址與單位。找到的跟規則的框重疊的不重複算（modelOnly），併進同一份結果
  const runModel = async () => {
    if (state.step !== "done") return;
    if (!confirmed.current) return setModel({ step: "asking" });
    const { lines, width, height, found: before } = state;
    setModel({ step: "running", progress: null });
    detector.current ??= piiDetector();
    try {
      const found = await detector.current.find(lines, width, height, (progress) => alive.current && setModel({ step: "running", progress }));
      if (!alive.current) return;
      const names = modelOnly(before.pii, found);
      setState({ ...state, found: { ...before, names } });
      setModel({ step: "done", n: names.length });
    } catch (error) {
      if (!alive.current) return;
      // 讀者按了停止（dispose），回到可以再按一次的狀態
      if ((error as Error).message === "disposed") return setModel({ step: "idle" });
      setModel({ step: "failed" });
    }
  };

  const stopModel = () => {
    detector.current?.dispose();
    detector.current = null;
  };

  const message = (): string => {
    switch (state.step) {
      case "idle":
        return "";
      case "faces":
        return t(state.progress === null ? "redact.loadingFaces" : "redact.findingFaces");
      case "text":
        return t(state.progress === null ? "redact.loadingText" : "redact.findingText");
      case "done": {
        const { found } = state;
        if (!foundAnything(found)) return t(found.names ? "screen.noneModel" : "screen.none");
        const parts = [
          found.faces.length ? t("screen.faces", { n: found.faces.length }) : "",
          found.maybe.length ? t("screen.maybe", { n: found.maybe.length }) : "",
          ...piiCounts(found.pii).map(({ kind, n }) => t("screen.pii", { n, kind: tDynamic(`screen.kind.${kind}`) })),
          ...modelCounts(found.names ?? []).map(({ kind, n }) => t("screen.pii", { n, kind: tDynamic(`screen.kind.${kind}`) })),
        ].filter(Boolean);
        return t("screen.found", { list: list(parts) });
      }
      case "failed":
        return t("screen.failed");
      case "blocked":
        return t("canvas.blocked");
      case "noWasm":
        return t("screen.noWasm");
      case "decodeFailed":
        return t("common.decodeFailed");
    }
  };

  const modelMessage = (): string => {
    switch (model.step) {
      case "running":
        return t(model.progress === null ? "screen.model.loading" : "screen.model.downloading");
      case "done":
        return model.n ? t("screen.model.found", { n: model.n }) : t("screen.model.none");
      case "failed":
        return t("screen.model.failed");
      default:
        return "";
    }
  };

  // 辨識文字的大小已經包含執行模型的程式，找人臉的模型只有 0.2 MB，不另外算
  const downloadNote =
    state.step === "idle" && download?.text ? t(download.stored ? "screen.download.first" : "screen.download.always", { mb: download.text }) : "";
  const canRetry = state.step === "idle" || state.step === "failed" || state.step === "blocked";
  const problem = state.step === "failed" || state.step === "blocked" || state.step === "noWasm" || state.step === "decodeFailed";
  const found = state.step === "done" && foundAnything(state.found) ? state.found : null;
  // 沒有讀到文字的圖不提供模型，交給它也找不到東西
  const hasText = state.step === "done" && state.lines.some((line) => line.text.trim());
  const modelOffer = hasText && (model.step === "idle" || model.step === "asking" || model.step === "failed");
  const status = modelMessage();

  return (
    <section aria-labelledby="screen-check-title" data-testid="screen-check" aria-busy={running || modelRunning}>
      <h2 id="screen-check-title">{t("screen.title")}</h2>
      <p class="hint">{t("screen.note")}</p>
      {downloadNote ? (
        <p class="hint" data-testid="screen-download">
          {downloadNote}
        </p>
      ) : null}
      {canRetry ? (
        <button type="button" disabled={busy || running} onClick={() => void check()}>
          {t("screen.check")}
        </button>
      ) : null}
      {/* 沒有找到用灰色，不用代表完成的綠色：自動尋找會漏，讀起來不能像「這張圖安全」 */}
      <p class={problem ? "error" : "hint"} role="status" data-testid="screen-status">
        {message()}
      </p>
      {found && canRedact ? (
        <button
          type="button"
          disabled={busy || modelRunning}
          onClick={() => {
            const boxes = screenBoxes(found);
            onRedact({ boxes, maybe: screenMaybe(found, boxes) });
          }}
        >
          {t("screen.redact")}
        </button>
      ) : null}
      {hasText && crashed ? (
        <p class={callout()} data-testid="screen-model-crashed">
          {t("screen.model.crashed")}
        </p>
      ) : hasText ? (
        <div class="screen-model" data-testid="screen-model">
          {modelOffer ? (
            <>
              {!phone && download?.pii ? (
                <p class="hint" data-testid="screen-model-note">
                  {t("screen.model.note", { mb: download.pii })}
                </p>
              ) : null}
              <div class="buttons">
                <button type="button" disabled={busy} onClick={() => void runModel()}>
                  <span class="tool-tag" aria-hidden="true">
                    <Icon name="brain" />
                  </span>
                  {t("screen.model.button")}
                </button>
              </div>
            </>
          ) : null}
          {model.step === "asking" ? (
            <div class="redact-model-ask" data-testid="screen-model-ask" role="group" aria-label={t("screen.model.button")}>
              <p>{t("screen.model.phone", { mb: download?.pii || PII_MB })}</p>
              <div class="buttons">
                <button
                  type="button"
                  class="primary"
                  onClick={() => {
                    confirmed.current = true;
                    void runModel();
                  }}
                >
                  {t("common.phoneGo")}
                </button>
                <a class="button" href={routeUrl("testing")} onClick={(e) => onRouteClick(e, () => navigate("testing"))}>
                  {t("common.phoneTest")}
                </a>
              </div>
            </div>
          ) : null}
          {status ? (
            <p class={model.step === "failed" ? "error" : "hint"} role="status" data-testid="screen-model-status">
              {status}
            </p>
          ) : null}
          {model.step === "running" ? (
            <>
              <ProgressBar label={t("screen.model.button")} value={model.progress} />
              <div class="buttons">
                <button type="button" onClick={stopModel}>
                  {t("screen.model.stop")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {receiving && state.step === "done" ? (
        <section class="screen-urls" aria-labelledby="screen-urls-title" data-testid="screen-urls">
          <h3 id="screen-urls-title">{t("urlocr.screenTitle")}</h3>
          {state.urls.length ? (
            <OcrUrlList urls={state.urls} onCheck={(url) => onOpenTool("url-check", url)} />
          ) : (
            <p class="hint">{t("urlocr.screenNone")}</p>
          )}
          {state.text ? (
            <>
              <div class="buttons">
                <CopyButton text={state.text} label={t("urlocr.copyText")} />
              </div>
              <p class="hint">{t("urlocr.copyNote")}</p>
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

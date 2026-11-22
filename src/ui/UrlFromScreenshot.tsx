import { useEffect, useRef, useState } from "preact/hooks";
import { isPhoto } from "../core/bytes.ts";
import type { TrayFile } from "../core/tray.ts";
import { type MessageKey, t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { assertCanvasReadable, isCanvasBlocked } from "./canvas-access.ts";
import { type DetectDownload, detectDownload } from "./detect-download.ts";
import { useTray } from "./hooks.ts";
import { decodeImage } from "./image-decode.ts";
import { OcrUrlList } from "./OcrUrlList.tsx";
import { ProgressBar } from "./ProgressBar.tsx";
import { type FoundUrl, urlsInImage } from "./url-ocr.ts";
import { wasmAvailable } from "./wasm.ts";
import { useWorking } from "./working.ts";

// 網址檢查的「從截圖讀出網址」：讀者選一張截圖或用暫存區裡的圖片，用遮蔽與檢查畫面內容同一套
// 文字辨識（PP-OCR，src/ui/redact-detect.ts 的 findText）讀出網址，列出來讓讀者對照截圖確認、修改，
// 按「檢查這個網址」才交給網址檢查。新選的截圖放進暫存區（目的記成檢查收到的），之後要遮蔽、查證不必再選，
// 關掉分頁就清空。
//
// 順序跟遮蔽的自動尋找一樣：按下按鈕的當下先看 WebAssembly、讀一次 canvas（Tor Browser 這時才會在網址列
// 跳出詢問），之後才打開選檔案的視窗、解碼與下載模型

type State =
  | { step: "idle" | "choose" }
  | { step: "reading"; progress: number | null }
  | { step: "done"; urls: FoundUrl[] }
  | { step: "failed" | "blocked" | "noWasm" | "decodeFailed" };

const latest = (f: TrayFile) => f.versions.at(-1)!;

export function UrlFromScreenshot({ onCheck }: { onCheck(url: string): void }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [download, setDownload] = useState<DetectDownload | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const { files } = useTray();
  const images = files.filter((f) => isPhoto(latest(f).format) && !latest(f).large);
  useEffect(() => {
    alive.current = true;
    void detectDownload().then((d) => alive.current && setDownload(d));
    return () => {
      alive.current = false;
    };
  }, []);
  const reading = state.step === "reading";
  useWorking(reading);

  const start = () => {
    if (!wasmAvailable()) return setState({ step: "noWasm" });
    try {
      assertCanvasReadable();
    } catch (error) {
      return setState({ step: isCanvasBlocked(error) ? "blocked" : "failed" });
    }
    if (images.length) return setState({ step: "choose" });
    // 上一次的錯誤說明（讀不到 canvas 這類）先拿掉，已經讀出的網址留著，讀者取消選檔案時照樣看得到
    if (state.step !== "done") setState({ step: "idle" });
    input.current?.click();
  };

  const read = async (blob: Blob) => {
    setState({ step: "reading", progress: null });
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await decodeImage(blob).catch(() => null);
      if (!bitmap) {
        if (alive.current) setState({ step: "decodeFailed" });
        return;
      }
      const { findText } = await import("./redact-detect.ts");
      const text = await findText(bitmap, (progress) => alive.current && setState({ step: "reading", progress }));
      // 裁切小圖在關掉圖片之前畫好
      const urls = urlsInImage(bitmap, text.ocr);
      if (alive.current) setState({ step: "done", urls });
    } catch (error) {
      if (alive.current) setState({ step: isCanvasBlocked(error) ? "blocked" : "failed" });
    } finally {
      bitmap?.close();
    }
  };

  const picked = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = "";
    if (!file) return;
    // 跟 Gears 其他工具一樣放進暫存區，目的記成檢查收到的（檔案畫面的工具列表把那一組排在前面）
    void tray.add([file], null, "check");
    void read(file);
  };

  const downloadNote =
    (state.step === "idle" || state.step === "choose") && download?.text
      ? t(download.stored ? "urlocr.download.first" : "urlocr.download.always", { mb: download.text })
      : "";
  const PROBLEMS: Partial<Record<State["step"], MessageKey>> = {
    failed: "urlocr.failed",
    blocked: "canvas.blocked",
    noWasm: "urlocr.noWasm",
    decodeFailed: "common.decodeFailed",
  };
  const problem = PROBLEMS[state.step];

  return (
    <div class="url-ocr" aria-busy={reading}>
      <div class="buttons">
        <button type="button" disabled={reading} onClick={start}>
          {t("urlocr.read")}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={picked} data-testid="url-ocr-input" />
      {downloadNote ? (
        <p class="hint" data-testid="url-ocr-download">
          {downloadNote}
        </p>
      ) : null}

      {state.step === "choose" ? (
        <section class="url-ocr-choose" aria-labelledby="url-ocr-choose-title">
          <h2 id="url-ocr-choose-title">{t("urlocr.choose")}</h2>
          <ul class="url-ocr-tray">
            {images.map((f) => (
              <li key={f.id}>
                <span>{f.name}</span>
                <button type="button" aria-label={t("urlocr.fromTrayNamed", { name: f.name })} onClick={() => void read(latest(f).blob)}>
                  {t("urlocr.fromTray")}
                </button>
              </li>
            ))}
          </ul>
          <div class="buttons">
            <button type="button" onClick={() => input.current?.click()}>
              {t("urlocr.pick")}
            </button>
            <button type="button" onClick={() => setState({ step: "idle" })}>
              {t("common.cancel")}
            </button>
          </div>
          <p class="hint">{t("urlocr.pickNote")}</p>
        </section>
      ) : null}

      {reading ? (
        <div class="url-ocr-progress">
          <p class="hint" role="status">
            {t(state.progress === null ? "urlocr.loading" : "urlocr.reading")}
          </p>
          <ProgressBar label={t("urlocr.read")} value={state.progress} />
        </div>
      ) : null}

      {problem ? (
        <p class="error" role="status" data-testid="url-ocr-status">
          {t(problem)}
        </p>
      ) : null}

      {state.step === "done" ? (
        <section class="url-ocr-result" aria-labelledby="url-ocr-title">
          <h2 id="url-ocr-title">{t("urlocr.title")}</h2>
          {state.urls.length ? (
            <OcrUrlList urls={state.urls} onCheck={onCheck} />
          ) : (
            // 沒有找到用灰色，不用代表完成的綠色：自動辨識會漏
            <p class="hint" role="status" data-testid="url-ocr-status">
              {t("urlocr.none")}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

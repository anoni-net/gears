import { useEffect, useRef, useState } from "preact/hooks";
import { list, t, tDynamic } from "../i18n/index.ts";
import type { Box } from "../tools/redact/index.ts";
import { type ScreenFound, foundAnything, piiCounts, screenBoxes, screenMaybe } from "../tools/redact/screen.ts";
import { assertCanvasReadable, isCanvasBlocked } from "./canvas-access.ts";
import { type DetectDownload, detectDownload } from "./detect-download.ts";
import { decodeImage } from "./image-decode.ts";
import { wasmAvailable } from "./wasm.ts";
import { useWorking } from "./working.ts";

// 檔案畫面的「畫面上看得到的」：清除中繼資料不會改變畫面，照片裡的人臉與截圖上的電話仍然看得到。
// 讀者按下檢查才載入模型，找人臉與辨識文字跟遮蔽的自動尋找是同一套（src/ui/redact-detect.ts），
// 模型下載一次，兩邊共用 gears-keep 的快取。找到的框交給遮蔽放好，由讀者逐一確認，這裡不改檔案。
//
// 檔案畫面依版本建立這個元件（key 是版本的 id），換了版本（縮成常見尺寸、HEIC 轉 JPEG 這類會改像素的處理）
// 結果跟著清掉，框的座標不會套到另一個版本上

type State =
  | { step: "idle" }
  | { step: "faces" | "text"; progress: number | null }
  | { step: "done"; found: ScreenFound }
  | { step: "failed" | "blocked" | "noWasm" | "decodeFailed" };

interface Props {
  blob: Blob;
  busy?: boolean;
  // 遮蔽接受這個格式時才有「打開遮蔽」的按鈕（TIFF 這類遮蔽不收的照樣可以檢查）
  canRedact: boolean;
  onRedact(found: { boxes: Box[]; maybe: Box[] }): void;
}

export function ScreenCheck({ blob, busy, canRedact, onRedact }: Props) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [download, setDownload] = useState<DetectDownload | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void detectDownload().then((d) => alive.current && setDownload(d));
    return () => {
      alive.current = false;
    };
  }, []);
  const running = state.step === "faces" || state.step === "text";
  useWorking(running);

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
      if (alive.current) setState({ step: "done", found: { faces: faces.faces, maybe: faces.maybe, pii: text.pii } });
    } catch (error) {
      if (alive.current) setState({ step: isCanvasBlocked(error) ? "blocked" : "failed" });
    } finally {
      bitmap?.close();
    }
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
        if (!foundAnything(found)) return t("screen.none");
        const parts = [
          found.faces.length ? t("screen.faces", { n: found.faces.length }) : "",
          found.maybe.length ? t("screen.maybe", { n: found.maybe.length }) : "",
          ...piiCounts(found.pii).map(({ kind, n }) => t("screen.pii", { n, kind: tDynamic(`screen.kind.${kind}`) })),
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
        return t("redact.decodeFailed");
    }
  };

  // 辨識文字的大小已經包含執行模型的程式，找人臉的模型只有 0.2 MB，不另外算
  const downloadNote =
    state.step === "idle" && download?.text ? t(download.stored ? "screen.download.first" : "screen.download.always", { mb: download.text }) : "";
  const canRetry = state.step === "idle" || state.step === "failed" || state.step === "blocked";
  const problem = state.step === "failed" || state.step === "blocked" || state.step === "noWasm" || state.step === "decodeFailed";
  const found = state.step === "done" && foundAnything(state.found) ? state.found : null;

  return (
    <section class="screen-check" aria-labelledby="screen-check-title" data-testid="screen-check">
      <h3 id="screen-check-title">{t("screen.title")}</h3>
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
          disabled={busy}
          onClick={() => {
            const boxes = screenBoxes(found);
            onRedact({ boxes, maybe: screenMaybe(found, boxes) });
          }}
        >
          {t("screen.redact")}
        </button>
      ) : null}
    </section>
  );
}

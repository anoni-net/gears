import { useEffect, useRef, useState } from "preact/hooks";
import type { Report } from "../core/tool.ts";
import { t, tDynamic } from "../i18n/index.ts";
import { type DotsFinding, type DotsMode, applyDots, judge, revealYellow } from "../tools/print-dots/index.ts";
import { trackFail } from "./analytics.ts";
import { assertCanvasReadable, canvasReadable, isCanvasBlocked } from "./canvas-access.ts";
import { decodeImage } from "./image-decode.ts";
import type { PdfPages } from "./pdf-pages.ts";
import type { FileEditorProps } from "./types.ts";

// 列印文件的追蹤點：先「只看黃色」看看紙上有沒有淡黃色的小點，再選擇去掉淡黃色或轉成黑白。
// 像素的處理在 src/tools/print-dots/，PDF 沿用遮蔽每一頁畫成圖片的流程（buildRedactedPdf 的 transform）。

export function PrintDotsEditor({ blob, format, onDone, onCancel }: FileEditorProps) {
  const isPdf = format === "pdf";
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfPages | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [view, setView] = useState<"original" | "yellow">("original");
  const [zoom, setZoom] = useState(false);
  const [finding, setFinding] = useState<DotsFinding | null>(null);
  const [mode, setMode] = useState<DotsMode>("yellow");
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "openFailed">("loading");
  // 瀏覽器不讓讀取 canvas（Tor Browser）。原圖照樣顯示，讀者允許之後按「只看黃色」或「套用」再讀一次
  const [blocked, setBlocked] = useState(false);
  const [retry, setRetry] = useState(0);
  const [building, setBuilding] = useState<[number, number] | null>(null);

  // 打開檔案：圖片解碼一次，PDF 用 pdf.js 一頁一頁畫
  useEffect(() => {
    let alive = true;
    let opened: PdfPages | null = null;
    void (async () => {
      if (isPdf) {
        const { openPdf } = await import("./pdf-pages.ts");
        opened = await openPdf(new Uint8Array(await blob.arrayBuffer()));
        if (!alive) return opened.close();
        setPdf(opened);
      } else {
        const decoded = await decodeImage(blob);
        if (!alive) return decoded.close();
        setBitmap(decoded);
        setStatus("ready");
      }
    })().catch(() => {
      trackFail("print-dots", "unsupported");
      if (alive) setStatus("openFailed");
    });
    return () => {
      alive = false;
      opened?.close();
    };
  }, [blob]);

  // PDF 換頁時畫出那一頁
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    void pdf.render(pageIndex).then((page) => {
      if (!alive) return page.close();
      setBitmap((old) => {
        old?.close();
        return page;
      });
      setStatus("ready");
    });
    return () => {
      alive = false;
    };
  }, [pdf, pageIndex]);

  // 畫到畫布上，同時算出這一頁有多少淡黃色的像素
  useEffect(() => {
    const el = canvas.current;
    if (!el || !bitmap) return;
    el.width = bitmap.width;
    el.height = bitmap.height;
    const ctx = el.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const readable = canvasReadable();
    setBlocked(!readable);
    if (!readable) return setFinding(null);
    const image = ctx.getImageData(0, 0, el.width, el.height);
    setFinding(judge(revealYellow(image.data), el.width * el.height));
    if (view === "yellow") ctx.putImageData(image, 0, 0);
  }, [bitmap, view, retry]);

  const apply = async () => {
    setStatus("working");
    setBlocked(false);
    try {
      // 讀不到 canvas 時輸出會是一張雜訊圖
      assertCanvasReadable();
      const removed: Report["removed"] = [{ code: mode === "yellow" ? "print-dots-yellow" : "print-dots-bw" }];
      if (pdf) {
        const { buildRedactedPdf } = await import("./pdf-pages.ts");
        const out = await buildRedactedPdf(pdf, [], {
          check: async () => {},
          onProgress: (done, all) => setBuilding([done, all]),
          transform: (pixels) => applyDots(pixels, mode),
        });
        setBuilding(null);
        onDone(out, { removed: [...removed, { code: "pdf-pages" }], kept: [] });
        return;
      }
      const el = document.createElement("canvas");
      el.width = bitmap!.width;
      el.height = bitmap!.height;
      const ctx = el.getContext("2d")!;
      // 黑白的頁面用 PNG（只有兩種顏色，檔案小、字的邊緣清楚），其他照原本的類型
      const png = mode === "black-white" || ["png", "gif", "bmp"].includes(format);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, el.width, el.height);
      ctx.drawImage(bitmap!, 0, 0);
      const image = ctx.getImageData(0, 0, el.width, el.height);
      applyDots(image.data, mode);
      ctx.putImageData(image, 0, 0);
      const out = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.92));
      el.width = el.height = 0;
      if (!out) throw new Error("encode");
      onDone(out, { removed: [...removed, { code: "reencode" }], kept: [] });
    } catch (error) {
      const canvasBlocked = isCanvasBlocked(error);
      trackFail("print-dots", canvasBlocked ? "canvas-blocked" : "broken");
      setBuilding(null);
      setBlocked(canvasBlocked);
      setStatus(canvasBlocked ? "ready" : "failed");
    }
  };

  if (status === "openFailed") {
    return (
      <div class="print-dots">
        <p class="error" role="alert">
          {t(isPdf ? "redact.pdfFailed" : "redact.decodeFailed")}
        </p>
        <div class="buttons">
          <button type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
        </div>
      </div>
    );
  }

  const total = pdf?.count ?? 1;
  return (
    <div class="print-dots">
      <p class="hint">{t("printDots.intro")}</p>
      <div class="buttons" role="group" aria-label={t("printDots.view")}>
        {(["original", "yellow"] as const).map((v) => (
          <button key={v} type="button" class={view === v ? "primary" : ""} aria-pressed={view === v} onClick={() => {
              setView(v);
              setRetry((n) => n + 1);
            }}>
            {tDynamic(`printDots.view.${v}`)}
          </button>
        ))}
        <button type="button" aria-pressed={zoom} onClick={() => setZoom((z) => !z)}>
          {t(zoom ? "printDots.fit" : "printDots.zoom")}
        </button>
      </div>
      {pdf && total > 1 ? (
        <div class="buttons">
          <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)}>
            {t("redact.prevPage")}
          </button>
          <span>{t("redact.page", { n: pageIndex + 1, total })}</span>
          <button type="button" disabled={pageIndex >= total - 1} onClick={() => setPageIndex((i) => i + 1)}>
            {t("redact.nextPage")}
          </button>
        </div>
      ) : null}
      <p class="hint" role="status" data-testid="print-dots-status">
        {blocked ? null : status === "loading" || finding === null ? t("printDots.loading") : tDynamic(`printDots.${finding}`)}
      </p>
      <div class={zoom ? "print-dots-canvas zoomed" : "print-dots-canvas"}>
        <canvas ref={canvas} data-testid="print-dots-canvas" role="img" aria-label={tDynamic(`printDots.view.${view}`)} />
      </div>

      <fieldset class="choices">
        <legend>{t("printDots.mode")}</legend>
        {(["yellow", "black-white"] as const).map((m) => (
          <label key={m} class="check">
            <input type="radio" name="print-dots-mode" checked={mode === m} onChange={() => setMode(m)} />
            <span>
              {tDynamic(`printDots.mode.${m}`)}
              <small class="hint">{tDynamic(`printDots.mode.${m}.desc`)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p class="hint">{t("printDots.limits")}</p>
      <div class="buttons">
        <button type="button" class="primary" disabled={!bitmap || status === "working"} onClick={apply}>
          {building ? t("redact.workingPage", { n: Math.min(building[0] + 1, building[1]), total: building[1] }) : status === "working" ? t("redact.working") : t("printDots.apply")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("printDots.failed")}
        </p>
      ) : null}
      {blocked ? (
        <p class="error" role="alert">
          {t("canvas.blocked")}
        </p>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";
import { pdfFailReason, trackFail } from "./analytics.ts";
import type { PdfPages } from "./pdf-pages.ts";
import type { FileEditorProps } from "./types.ts";

// 選擇要交出去的頁面。縮圖捲進畫面才畫，長的文件不會一打開就把每一頁都畫一次
const THUMB_SIDE = 240;

function Thumb({ pdf, index }: { pdf: PdfPages; index: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"waiting" | "drawn" | "failed">("waiting");
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let alive = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        pdf
          .render(index, THUMB_SIDE)
          .then((bitmap) => {
            if (alive) {
              el.width = bitmap.width;
              el.height = bitmap.height;
              el.getContext("2d")!.drawImage(bitmap, 0, 0);
              setState("drawn");
            }
            bitmap.close();
          })
          .catch(() => alive && setState("failed"));
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [pdf, index]);
  return <canvas ref={canvas} class={`page-thumb ${state}`} aria-hidden="true" />;
}

// 放大看一頁：縮圖太小、看不清楚內容時用。跟遮蔽一樣畫到長邊 2400 像素，預設依對話框的寬度
// 縮放。手機的對話框只有三百多像素寬，A4 的小字仍然看不清楚，可以再切換成兩倍寬（不超過畫出來的
// 像素，也不比符合寬度小），用手指拖曳。在這裡也能換頁與勾選，不必關掉再找下一張縮圖
const ZOOM_SIDE = 2400;

function ZoomDialog(props: { pdf: PdfPages; index: number; checked: boolean; onToggle(): void; onTurn(index: number): void; onClose(): void }) {
  const { pdf, index } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.open && el.close();
  }, []);

  useEffect(() => {
    let alive = true;
    setDrawn(false);
    pdf
      .render(index, ZOOM_SIDE)
      .then((bitmap) => {
        const el = canvas.current;
        if (alive && el) {
          el.width = bitmap.width;
          el.height = bitmap.height;
          el.getContext("2d")!.drawImage(bitmap, 0, 0);
          setDrawn(true);
        }
        bitmap.close();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pdf, index]);

  const keyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "ArrowLeft" && index > 0) props.onTurn(index - 1);
    else if (e.key === "ArrowRight" && index < pdf.count - 1) props.onTurn(index + 1);
    else return;
    e.preventDefault();
  };

  return (
    <dialog ref={dialog} class="page-zoom" aria-label={t("pdfPages.page", { n: index + 1 })} onClose={props.onClose} onKeyDown={keyDown}>
      <div class="page-zoom-bar">
        <button type="button" disabled={index === 0} onClick={() => props.onTurn(index - 1)}>
          {t("redact.prevPage")}
        </button>
        <span aria-live="polite">{t("redact.page", { n: index + 1, total: pdf.count })}</span>
        <button type="button" disabled={index === pdf.count - 1} onClick={() => props.onTurn(index + 1)}>
          {t("redact.nextPage")}
        </button>
      </div>
      <div class={enlarged ? "page-zoom-stage enlarged" : "page-zoom-stage"}>
        {drawn ? null : <p class="hint">{t("redact.loadingPage")}</p>}
        <canvas
          ref={canvas}
          class={drawn ? "" : "waiting"}
          // 最多到畫出來的像素，但不比符合寬度還小（頁面很小、對話框很寬時）
          style={enlarged && canvas.current ? { maxWidth: `max(${canvas.current.width}px, 100%)` } : undefined}
          data-testid="page-zoom-canvas"
          aria-hidden="true"
        />
      </div>
      <div class="page-zoom-bar">
        <label class="check">
          <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
          <span>{t("pdfPages.keepThis")}</span>
        </label>
        <button type="button" aria-pressed={enlarged} onClick={() => setEnlarged((v) => !v)}>
          {t(enlarged ? "pdfPages.fit" : "pdfPages.enlarge")}
        </button>
        <button type="button" class="primary" onClick={() => dialog.current!.close()}>
          {t("pdfPages.closeZoom")}
        </button>
      </div>
    </dialog>
  );
}

export function PdfPagesEditor({ blob, onDone, onCancel }: FileEditorProps) {
  const [pdf, setPdf] = useState<PdfPages | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "openFailed">("loading");
  // 轉成圖片：字型與文字層都不帶過去，其他頁用過的字也就不會留在字型裡
  const [asImages, setAsImages] = useState(false);
  const [building, setBuilding] = useState<[number, number] | null>(null);
  // 放大中的頁面
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: PdfPages | null = null;
    void (async () => {
      const { openPdf } = await import("./pdf-pages.ts");
      opened = await openPdf(new Uint8Array(await blob.arrayBuffer()));
      if (!alive) return opened.close();
      setPdf(opened);
      setStatus("ready");
    })().catch((error: unknown) => {
      trackFail("pdf-pages", pdfFailReason(error));
      if (alive) setStatus("openFailed");
    });
    return () => {
      alive = false;
      opened?.close();
    };
  }, [blob]);

  const total = pdf?.count ?? 0;
  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const apply = async () => {
    setStatus("working");
    try {
      const indices = [...selected].sort((a, b) => a - b);
      if (asImages && pdf) {
        const { buildRedactedPdf } = await import("./pdf-pages.ts");
        const out = await buildRedactedPdf(pdf, [], { check: async () => {}, onProgress: (done, all) => setBuilding([done, all]) }, indices);
        setBuilding(null);
        onDone(out, { removed: [{ code: "pdf-pages-removed", count: total - indices.length }, { code: "pdf-pages" }], kept: [] });
        return;
      }
      const { keepPages } = await import("../tools/pdf-pages/index.ts");
      const result = await keepPages(new Uint8Array(await blob.arrayBuffer()), [...selected]);
      onDone(new Blob([result.data as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), result.report);
    } catch {
      // 解不開的內容或檢查沒有通過（新檔裡出現沒選的頁面），都不交出結果
      trackFail("pdf-pages", "broken");
      setBuilding(null);
      setStatus("failed");
    }
  };

  if (status === "openFailed") {
    return (
      <div class="pdf-pages">
        <p class="error" role="alert">
          {t("redact.pdfFailed")}
        </p>
        <div class="buttons">
          <button type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
        </div>
      </div>
    );
  }

  const usable = selected.size > 0 && selected.size < total;
  return (
    <div class="pdf-pages">
      <p class="hint">{t("pdfPages.help")}</p>
      {pdf && total === 1 ? <p class="hint">{t("pdfPages.single")}</p> : null}
      <div class="pdf-pages-toolbar">
        <button type="button" disabled={!pdf || selected.size === total} onClick={() => setSelected(new Set(Array.from({ length: total }, (_, i) => i)))}>
          {t("pdfPages.all")}
        </button>
        <button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>
          {t("pdfPages.none")}
        </button>
      </div>
      {/* 在縮圖格上方，頁數多的文件不必捲到最底才看得到 */}
      <label class="check">
        <input type="checkbox" checked={asImages} onChange={(e) => setAsImages((e.currentTarget as HTMLInputElement).checked)} />
        <span>
          {t("pdfPages.asImages")}
          <small>{t("pdfPages.asImagesNote")}</small>
        </span>
      </label>
      {pdf ? (
        <ul class="page-grid">
          {Array.from({ length: total }, (_, index) => (
            <li key={index} class={selected.has(index) ? "page-card checked" : "page-card"}>
              <label class="page-pick">
                <Thumb pdf={pdf} index={index} />
                <span>
                  <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                  {t("pdfPages.page", { n: index + 1 })}
                </span>
              </label>
              <button type="button" class="page-zoom-open" aria-label={t("pdfPages.zoomPage", { n: index + 1 })} onClick={() => setZoom(index)}>
                <Icon name="magnify-plus-outline" />
                <span aria-hidden="true">{t("pdfPages.zoom")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint" role="status">
          {t("redact.loadingPage")}
        </p>
      )}
      {pdf && zoom !== null ? (
        <ZoomDialog pdf={pdf} index={zoom} checked={selected.has(zoom)} onToggle={() => toggle(zoom)} onTurn={setZoom} onClose={() => setZoom(null)} />
      ) : null}
      <div class="redact-actions">
        <p aria-live="polite">{t("pdfPages.count", { n: selected.size, total })}</p>
        <div class="buttons">
          <button type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
          <button type="button" class="primary" disabled={!usable || status === "working"} onClick={apply}>
            {building ? t("redact.workingPage", { n: Math.min(building[0] + 1, building[1]), total: building[1] }) : status === "working" ? t("redact.working") : t("pdfPages.apply")}
          </button>
        </div>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("pdfPages.failed")}
        </p>
      ) : null}
    </div>
  );
}

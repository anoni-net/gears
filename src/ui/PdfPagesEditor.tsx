import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
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

export function PdfPagesEditor({ blob, onDone, onCancel }: FileEditorProps) {
  const [pdf, setPdf] = useState<PdfPages | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "openFailed">("loading");
  // 轉成圖片：字型與文字層都不帶過去，其他頁用過的字也就不會留在字型裡
  const [asImages, setAsImages] = useState(false);
  const [building, setBuilding] = useState<[number, number] | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: PdfPages | null = null;
    void (async () => {
      const { openPdf } = await import("./pdf-pages.ts");
      opened = await openPdf(new Uint8Array(await blob.arrayBuffer()));
      if (!alive) return opened.close();
      setPdf(opened);
      setStatus("ready");
    })().catch(() => alive && setStatus("openFailed"));
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
            <li key={index}>
              <label class={selected.has(index) ? "page-pick checked" : "page-pick"}>
                <Thumb pdf={pdf} index={index} />
                <span>
                  <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                  {t("pdfPages.page", { n: index + 1 })}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint" role="status">
          {t("redact.loadingPage")}
        </p>
      )}
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

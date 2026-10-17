import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon.tsx";
import { pdfFailReason, trackFail } from "./analytics.ts";
import type { Format } from "../core/bytes.ts";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { type Box, boxFromPoints, isDark, isUsable, samplePoints } from "../tools/redact/index.ts";
import { assertCanvasReadable, isCanvasBlocked } from "./canvas-access.ts";
import { decodeImage } from "./image-decode.ts";
import { overlaps } from "../tools/redact/pii.ts";
import { extractExif, insertExifJpeg, insertExifPng, rebuildExif } from "../tools/redact/keep-exif.ts";
import { exifFindings, parseExif } from "../tools/strip-metadata/exif.ts";
import type { FileEditorProps } from "./types.ts";
import type { PdfPages } from "./pdf-pages.ts";
import { useWorking } from "./working.ts";

// 編輯時畫面上的圖最多 1600 像素寬，框的座標一律存成原圖的像素
const PREVIEW_MAX = 1600;

function drawBoxes(ctx: CanvasRenderingContext2D, boxes: Box[], scale: number) {
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
}

// 可能是臉的範圍：黃色虛線，外圈再描一圈黑線，亮暗的背景上都看得到。只在編輯畫面上畫，不會輸出
function drawMaybe(ctx: CanvasRenderingContext2D, boxes: Box[], scale: number) {
  ctx.save();
  ctx.lineWidth = 3;
  for (const [color, dash] of [["#000", 0], ["#ffca28", 6]] as const) {
    ctx.strokeStyle = color;
    ctx.lineDashOffset = 0;
    ctx.setLineDash(dash ? [dash, dash] : []);
    for (const b of boxes) ctx.strokeRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
  }
  ctx.fillStyle = "rgba(255, 202, 40, 0.18)";
  for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
  ctx.restore();
}

// 把編碼好的圖解碼回來，抽查每個框裡的點，都要是黑的
async function checkDark(blob: Blob, boxes: Box[]) {
  const check = await createImageBitmap(blob);
  const verify = document.createElement("canvas");
  verify.width = check.width;
  verify.height = check.height;
  const vctx = verify.getContext("2d", { willReadFrequently: true })!;
  vctx.drawImage(check, 0, 0);
  check.close();
  for (const box of boxes) {
    for (const [x, y] of samplePoints(box)) {
      const [r, g, b] = vctx.getImageData(x, y, 1, 1).data;
      if (!isDark(r!, g!, b!)) throw new Error("not dark");
    }
  }
}

// 原尺寸塗黑、重新編碼，再把輸出解碼回來抽查每個框，確認真的是黑的。
// exif 是讀者選擇保留的拍攝資訊（已經拿掉縮圖），抽查通過之後才寫回去
async function render(bitmap: ImageBitmap, boxes: Box[], format: Format, exif: Uint8Array | null): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  // 瀏覽器只編碼得了 JPEG 與 PNG。PNG、GIF、BMP 這類常是截圖或圖示，輸出 PNG，其他輸出 JPEG
  const jpeg = !["png", "gif", "bmp"].includes(format);
  if (jpeg) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  drawBoxes(ctx, boxes, 1);
  const type = jpeg ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error("encode");
  await checkDark(blob, boxes);
  if (!exif) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([(jpeg ? insertExifJpeg(bytes, exif) : insertExifPng(bytes, exif)) as Uint8Array<ArrayBuffer>], { type });
}

export function RedactEditor({ blob, format, onDone, onCancel }: FileEditorProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  // PDF 一頁一頁框選，每一頁的框分開存。圖片只有一頁
  const isPdf = format === "pdf";
  const [pdf, setPdf] = useState<PdfPages | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageBoxes, setPageBoxes] = useState<Box[][]>([]);
  const boxes = pageBoxes[pageIndex] ?? [];
  const setBoxes = (next: Box[] | ((list: Box[]) => Box[])) =>
    setPageBoxes((all) => {
      const copy = [...all];
      copy[pageIndex] = typeof next === "function" ? next(all[pageIndex] ?? []) : next;
      return copy;
    });
  const total = pageBoxes.reduce((n, list) => n + (list?.length ?? 0), 0);
  // 輸出 PDF 時處理到第幾頁
  const [building, setBuilding] = useState<[number, number] | null>(null);
  // 自動尋找是非同步的，找完時要拿最新的框，不是按下按鈕那時候的
  const latest = useRef<Box[]>([]);
  latest.current = boxes;
  const [draft, setDraft] = useState<Box | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "decodeFailed">("loading");
  // 瀏覽器不讓讀取 canvas（Tor Browser）。框留著，讀者允許之後可以再按一次
  const [canvasBlocked, setCanvasBlocked] = useState(false);
  const start = useRef<[number, number] | null>(null);
  // 畫布上的手指。兩根以上就改成捲動頁面，記下上一次的中點
  const touches = useRef(new Map<number, [number, number]>());
  // 鍵盤操作：方向鍵移動游標，Enter 先標一個角、再標對角
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [corner, setCorner] = useState<[number, number] | null>(null);
  const panning = useRef<number | null>(null);
  const middle = () => [...touches.current.values()].reduce((n, [, y]) => n + y, 0) / touches.current.size;
  // 自動尋找：哪一種正在跑、找到幾個，文字辨識另外留下每一行的範圍
  // progress 是 0 到 1，null 表示還在載入模型
  const [auto, setAuto] = useState<{
    kind: "faces" | "text" | "lines";
    state: "running" | "done" | "failed" | "blocked";
    n: number;
    progress?: number | null;
  } | null>(null);
  const [textLines, setTextLines] = useState<Box[]>([]);
  useWorking(status === "working" || auto?.state === "running" || !!building);
  // 找人臉時「可能是臉」的範圍，畫成虛線，讀者點一下才變成遮蔽框
  const [maybe, setMaybe] = useState<Box[]>([]);
  // 原檔的拍攝資訊（已經重組、拿掉縮圖），沒有時間、地點或型號就不提供保留的選項
  const [exif, setExif] = useState<Uint8Array | null>(null);
  const [keepExif, setKeepExif] = useState(false);

  useEffect(() => {
    let alive = true;
    void blob.arrayBuffer().then((buffer) => {
      const source = extractExif(new Uint8Array(buffer), format);
      const rebuilt = source && rebuildExif(source);
      const useful = rebuilt && exifFindings(parseExif(rebuilt)).some((f) => ["location", "datetime", "device"].includes(f.code));
      if (alive) setExif(useful ? rebuilt : null);
    });
    return () => {
      alive = false;
    };
  }, [blob, format]);

  // PDF：開啟一次，換頁時再畫那一頁
  useEffect(() => {
    if (!isPdf) return;
    let alive = true;
    let opened: PdfPages | null = null;
    void (async () => {
      const { openPdf } = await import("./pdf-pages.ts");
      opened = await openPdf(new Uint8Array(await blob.arrayBuffer())).catch((error: unknown) => {
        trackFail("redact", pdfFailReason(error));
        throw error;
      });
      if (!alive) return opened.close();
      setPdf(opened);
    })().catch(() => alive && setStatus("decodeFailed"));
    return () => {
      alive = false;
      opened?.close();
    };
  }, [blob, isPdf]);

  // PDF 換頁時，前一頁的圖片等新的一頁畫好、畫布換過去之後才釋放
  const shown = useRef<ImageBitmap | null>(null);
  useEffect(() => () => shown.current?.close(), []);

  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    setBitmap(null);
    setStatus("loading");
    // 換頁時，前一頁的自動尋找結果與鍵盤游標不帶過來
    setAuto(null);
    setMaybe([]);
    setTextLines([]);
    setCursor(null);
    setCorner(null);
    pdf
      .render(pageIndex)
      .then((bmp) => {
        if (!alive) return bmp.close();
        const old = shown.current;
        shown.current = bmp;
        setBitmap(bmp);
        setStatus("ready");
        old?.close();
      })
      .catch(() => alive && setStatus("decodeFailed"));
    return () => {
      alive = false;
    };
  }, [pdf, pageIndex]);

  useEffect(() => {
    if (isPdf) return;
    let alive = true;
    let opened: ImageBitmap | null = null;
    decodeImage(blob)
      .then((bmp) => {
        opened = bmp;
        if (alive) {
          setBitmap(bmp);
          setStatus("ready");
        }
      })
      .catch(() => alive && setStatus("decodeFailed"));
    return () => {
      alive = false;
      opened?.close();
    };
  }, [blob, isPdf]);

  const scale = bitmap ? Math.min(1, PREVIEW_MAX / bitmap.width) : 1;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !bitmap) return;
    el.width = Math.round(bitmap.width * scale);
    el.height = Math.round(bitmap.height * scale);
    const ctx = el.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, el.width, el.height);
    drawBoxes(ctx, boxes, scale);
    drawMaybe(ctx, maybe, scale);
    if (draft) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(draft.x * scale, draft.y * scale, draft.w * scale, draft.h * scale);
    }
    if (cursor) {
      // 鍵盤的游標：十字線，標了第一個角時畫出預覽的框
      const [cx, cy] = [cursor[0] * scale, cursor[1] * scale];
      if (corner) {
        const b = boxFromPoints(corner[0], corner[1], cursor[0], cursor[1], bitmap.width, bitmap.height);
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
      }
      ctx.strokeStyle = "#e53935";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy);
      ctx.lineTo(cx + 12, cy);
      ctx.moveTo(cx, cy - 12);
      ctx.lineTo(cx, cy + 12);
      ctx.stroke();
    }
  }, [bitmap, boxes, maybe, draft, scale, cursor, corner]);

  const keyDown = (e: KeyboardEvent) => {
    if (!bitmap || status !== "ready") return;
    const [x, y] = cursor ?? [bitmap.width / 2, bitmap.height / 2];
    const step = (e.shiftKey ? 0.1 : 0.02) * Math.max(bitmap.width, bitmap.height);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setCursor([Math.min(bitmap.width, Math.max(0, x + move[0])), Math.min(bitmap.height, Math.max(0, y + move[1]))]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!cursor) return setCursor([x, y]);
      if (!corner) return setCorner([x, y]);
      const box = boxFromPoints(corner[0], corner[1], x, y, bitmap.width, bitmap.height);
      if (isUsable(box, 4)) setBoxes((list) => [...list, box]);
      setCorner(null);
    } else if (e.key === "Escape" && corner) {
      e.preventDefault();
      setCorner(null);
    } else if ((e.key === "Delete" || e.key === "Backspace") && boxes.length) {
      e.preventDefault();
      setBoxes((list) => list.slice(0, -1));
    }
  };

  // 畫面上的座標換回原圖的像素
  const toImage = (e: PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * bitmap!.width, ((e.clientY - rect.top) / rect.height) * bitmap!.height];
  };

  const down = (e: PointerEvent) => {
    if (!bitmap || status !== "ready") return;
    e.preventDefault();
    touches.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.current.size >= 2) {
      // 第二根手指放下：放棄正在拉的框，改成捲動
      start.current = null;
      setDraft(null);
      panning.current = middle();
      return;
    }
    canvas.current!.setPointerCapture(e.pointerId);
    start.current = toImage(e);
  };
  const move = (e: PointerEvent) => {
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (panning.current !== null) {
      const now = middle();
      window.scrollBy(0, panning.current - now);
      panning.current = now;
      return;
    }
    if (!start.current || !bitmap) return;
    const [x, y] = toImage(e);
    setDraft(boxFromPoints(start.current[0], start.current[1], x, y, bitmap.width, bitmap.height));
  };
  const release = (e: PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) panning.current = null;
  };

  const up = (e: PointerEvent) => {
    const wasPanning = panning.current !== null || touches.current.size > 1;
    release(e);
    if (wasPanning) {
      start.current = null;
      return;
    }
    if (!start.current || !bitmap) return;
    const [x, y] = toImage(e);
    const box = boxFromPoints(start.current[0], start.current[1], x, y, bitmap.width, bitmap.height);
    start.current = null;
    setDraft(null);
    if (isUsable(box, 4 / scale)) {
      setBoxes((list) => [...list, box]);
    } else {
      // 點一下已經框好的範圍就刪掉它，點到虛線的「可能是臉」就加成遮蔽框
      const inside = (b: Box) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      const hit = boxes.filter(inside).at(-1);
      if (hit) setBoxes(boxes.filter((b) => b !== hit));
      else {
        const pick = maybe.filter(inside).at(-1);
        if (pick) acceptMaybe([pick]);
      }
    }
  };

  // 找到的框加進去，跟已經有的框重疊的不重複加
  const addFound = (found: Box[]) => {
    const next = [...latest.current];
    for (const box of found) if (!next.some((b) => overlaps(b, box))) next.push(box);
    setBoxes(next);
    return next.length - latest.current.length;
  };

  const acceptMaybe = (picked: Box[]) => {
    const added = addFound(picked);
    setMaybe((list) => list.filter((m) => !picked.includes(m)));
    // 訊息裡的框數跟著加上
    setAuto((a) => (a?.kind === "faces" && a.state === "done" ? { ...a, n: a.n + added } : a));
  };

  const runAuto = async (kind: "faces" | "text" | "lines") => {
    if (!bitmap) return;
    // 已經辨識過文字，直接把每一行框起來
    if (kind === "lines" && textLines.length) {
      setAuto({ kind, state: "done", n: addFound(textLines) });
      return;
    }
    setAuto({ kind, state: "running", n: 0, progress: null });
    const onProgress = (progress: number | null) =>
      setAuto((a) => (a?.kind === kind && a.state === "running" ? { ...a, progress } : a));
    try {
      assertCanvasReadable();
      const { findFaces, findText } = await import("./redact-detect.ts");
      if (kind === "faces") {
        const { faces, maybe: possible } = await findFaces(bitmap, onProgress);
        setAuto({ kind, state: "done", n: addFound(faces) || faces.length });
        setMaybe(possible.filter((m) => !latest.current.some((b) => overlaps(b, m))));
      } else {
        const { pii, lines } = await findText(bitmap, onProgress);
        setTextLines(lines);
        const found = kind === "lines" ? lines : pii.map((m) => m.box);
        setAuto({ kind, state: "done", n: addFound(found) || found.length });
      }
    } catch (error) {
      setAuto({ kind, state: isCanvasBlocked(error) ? "blocked" : "failed", n: 0 });
    }
  };

  const running = auto?.state === "running";
  const turnPage = (step: number) => setPageIndex((i) => Math.min(pdf!.count - 1, Math.max(0, i + step)));

  const autoMessage = (a: typeof auto): string => {
    // 圖片還在解碼時也顯示在這裡，不另佔一行，解碼完圖片不會往上跳
    if (status === "loading") return t(isPdf ? "redact.loadingPage" : "redact.loading");
    if (!a) return t("redact.autoNote");
    if (a.state === "failed") return t("redact.findFailed");
    if (a.state === "blocked") return t("canvas.blocked");
    if (a.state === "running") {
      if (a.kind === "faces") return t(a.progress == null ? "redact.loadingFaces" : "redact.findingFaces");
      return t(a.progress == null ? "redact.loadingText" : "redact.findingText");
    }
    if (a.kind === "faces" && maybe.length) {
      return a.n ? t("redact.foundMaybe", { n: a.n, m: maybe.length }) : t("redact.onlyMaybe", { m: maybe.length });
    }
    return a.n ? t("redact.found", { n: a.n }) : t("redact.foundNone");
  };

  const apply = async () => {
    if ((!bitmap && !pdf) || !total) return;
    setStatus("working");
    setCanvasBlocked(false);
    try {
      // 輸出之後要讀回來抽查每個框，瀏覽器不讓讀取 canvas 時輸出也是一張雜訊圖
      assertCanvasReadable();
      if (pdf) {
        const { buildRedactedPdf } = await import("./pdf-pages.ts");
        const out = await buildRedactedPdf(pdf, pageBoxes, {
          check: checkDark,
          onProgress: (done, all) => setBuilding([done, all]),
        });
        setBuilding(null);
        onDone(out, { removed: [{ code: "redaction", count: total }, { code: "pdf-pages" }], kept: [] });
        return;
      }
      const kept = keepExif ? exif : null;
      const out = await render(bitmap!, boxes, format, kept);
      const report: Report = {
        removed: [{ code: "redaction", count: boxes.length }, { code: "reencode" }],
        kept: kept ? [{ code: "exif-kept" }] : [],
      };
      onDone(out, report);
    } catch (error) {
      const blocked = isCanvasBlocked(error);
      trackFail("redact", blocked ? "canvas-blocked" : "broken");
      setBuilding(null);
      setCanvasBlocked(blocked);
      setStatus(blocked ? "ready" : "failed");
    }
  };

  return (
    <div class="redact">
      <p class="hint">{t("redact.help")}</p>
      {status === "decodeFailed" ? (
        <p class="error" role="alert">
          {t(isPdf ? "redact.pdfFailed" : "redact.decodeFailed")}
        </p>
      ) : null}
      {/* 會改變框的動作都在圖片上方，套用與取消固定在底部的完成列 */}
      <div class="redact-auto">
        <button type="button" disabled={!bitmap || running} onClick={() => runAuto("faces")}>
          {t("redact.findFaces")}
        </button>
        <button type="button" disabled={!bitmap || running} onClick={() => runAuto("text")}>
          {t("redact.findText")}
        </button>
        <button type="button" disabled={!bitmap || running} onClick={() => runAuto("lines")}>
          {t("redact.findLines")}
        </button>
        <span class="redact-toolbar-divider" aria-hidden="true" />
        {/* 窄螢幕只顯示圖示，文字仍在按鈕裡給讀螢幕軟體，滑鼠移上去也看得到 */}
        <button type="button" class="icon-button" title={t("redact.undo")} disabled={!boxes.length} onClick={() => setBoxes((list) => list.slice(0, -1))}>
          <Icon name="undo" />
          <span class="label">{t("redact.undo")}</span>
        </button>
        <button type="button" class="icon-button" title={t(pdf ? "redact.clearPage" : "redact.clear")} disabled={!boxes.length} onClick={() => setBoxes([])}>
          <Icon name="delete-sweep-outline" />
          <span class="label">{t(pdf ? "redact.clearPage" : "redact.clear")}</span>
        </button>
      </div>
      {/* 訊息區的高度固定：所有可能出現的訊息疊在同一格，用最長的那一則撐開，
          換訊息時下面的圖片不會跳動。看得到、唸得出來的只有目前那一則 */}
      <div class="redact-auto-message">
        <div>
          <p class={auto?.state === "failed" || auto?.state === "blocked" ? "error" : "hint"} role="status" data-testid="redact-auto-status">
            {autoMessage(auto)}
          </p>
          {maybe.length && auto?.state !== "running" ? (
            <button type="button" class="link" onClick={() => acceptMaybe(maybe)}>
              {t("redact.addMaybe", { m: maybe.length })}
            </button>
          ) : null}
        </div>
        <div class="sizer" aria-hidden="true">
          {AUTO_MESSAGES.map((key) => (
            <p key={key}>{t(key, { n: 999, m: 99 })}</p>
          ))}
          {/* 有「全部加上」按鈕的那兩則，連同按鈕一起佔位 */}
          {(["redact.foundMaybe", "redact.onlyMaybe"] as const).map((key) => (
            <div key={key}>
              <p>{t(key, { n: 999, m: 99 })}</p>
              <span class="link">{t("redact.addMaybe", { m: 99 })}</span>
            </div>
          ))}
        </div>
      </div>
      {pdf ? (
        <div class="redact-pages">
          <button type="button" disabled={pageIndex === 0 || running || status === "working"} onClick={() => turnPage(-1)}>
            {t("redact.prevPage")}
          </button>
          <span aria-live="polite">{t("redact.page", { n: pageIndex + 1, total: pdf.count })}</span>
          <button type="button" disabled={pageIndex === pdf.count - 1 || running || status === "working"} onClick={() => turnPage(1)}>
            {t("redact.nextPage")}
          </button>
        </div>
      ) : null}
      <div class="redact-stage">
        <canvas
          ref={canvas}
          class="redact-canvas"
          data-testid="redact-canvas"
          tabIndex={0}
          role="application"
          aria-label={t("redact.canvasLabel")}
          aria-describedby="redact-keys"
          onKeyDown={keyDown}
          onBlur={() => setCorner(null)}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={(e) => {
            release(e);
            start.current = null;
            setDraft(null);
          }}
        />
        {/* 處理中蓋在圖片上，不佔版面 */}
        {running ? <AutoProgress label={t(auto!.kind === "faces" ? "redact.findFaces" : auto!.kind === "lines" ? "redact.findLines" : "redact.findText")} value={auto!.progress ?? null} /> : null}
      </div>
      {exif ? (
        <label class="check">
          <input type="checkbox" checked={keepExif} onChange={(e) => setKeepExif((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            {t("redact.keepExif")}
            <small>{t("redact.keepExifNote")}</small>
          </span>
        </label>
      ) : null}
      <div class="redact-actions">
        <p aria-live="polite">
          {corner
            ? t("redact.cornerSet")
            : pdf && pdf.count > 1
              ? t("redact.countPages", { n: total, page: boxes.length })
              : t("redact.count", { n: total })}
        </p>
        <div class="buttons">
          <button type="button" class="primary" disabled={!total || status === "working"} onClick={apply}>
            {building ? t("redact.workingPage", { n: Math.min(building[0] + 1, building[1]), total: building[1] }) : status === "working" ? t("redact.working") : t("redact.apply")}
          </button>
          <button type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
        </div>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("redact.failed")}
        </p>
      ) : null}
      {canvasBlocked ? (
        <p class="error" role="alert">
          {t("canvas.blocked")}
        </p>
      ) : null}
      <p class="hint" id="redact-keys">
        {t("redact.keys")}
      </p>
      {isPdf ? <p class="hint">{t("redact.pdfNote")}</p> : null}
      <p class="hint">{t("redact.note")}</p>
    </div>
  );
}

// 訊息區可能出現的每一則訊息，用來撐開固定的高度
const AUTO_MESSAGES = [
  "redact.loading",
  "redact.autoNote",
  "redact.findFailed",
  "redact.loadingFaces",
  "redact.findingFaces",
  "redact.loadingText",
  "redact.findingText",
  "redact.found",
  "redact.foundNone",
] as const;

// 自動尋找的進度條，蓋在圖片上。載入模型時不知道要多久，顯示來回移動的條紋；偵測時顯示百分比
function AutoProgress({ label, value }: { label: string; value: number | null }) {
  const percent = value === null ? null : Math.round(value * 100);
  return (
    <div class="auto-progress" data-testid="redact-auto-progress">
      <div
        class="auto-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div class={percent === null ? "auto-progress-bar indeterminate" : "auto-progress-bar"} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
      <span aria-hidden="true">{percent === null ? "" : `${percent}%`}</span>
    </div>
  );
}

import { useEffect, useRef, useState } from "preact/hooks";
import type { Format } from "../core/bytes.ts";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { type Box, boxFromPoints, isDark, isUsable, samplePoints } from "../tools/redact/index.ts";
import { decodeImage } from "./image-decode.ts";
import { overlaps } from "../tools/redact/pii.ts";
import { extractExif, insertExifJpeg, insertExifPng, rebuildExif } from "../tools/redact/keep-exif.ts";
import { exifFindings, parseExif } from "../tools/strip-metadata/exif.ts";
import type { FileEditorProps } from "./types.ts";

// 編輯時畫面上的圖最多 1600 像素寬，框的座標一律存成原圖的像素
const PREVIEW_MAX = 1600;

function drawBoxes(ctx: CanvasRenderingContext2D, boxes: Box[], scale: number) {
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
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
  if (!exif) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([(jpeg ? insertExifJpeg(bytes, exif) : insertExifPng(bytes, exif)) as Uint8Array<ArrayBuffer>], { type });
}

export function RedactEditor({ blob, format, onDone, onCancel }: FileEditorProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  // 自動尋找是非同步的，找完時要拿最新的框，不是按下按鈕那時候的
  const latest = useRef<Box[]>([]);
  latest.current = boxes;
  const [draft, setDraft] = useState<Box | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "decodeFailed">("loading");
  const start = useRef<[number, number] | null>(null);
  // 自動尋找：哪一種正在跑、找到幾個，文字辨識另外留下每一行的範圍
  const [auto, setAuto] = useState<{ kind: "faces" | "text" | "lines"; state: "running" | "done" | "failed" | "noWebgl"; n: number } | null>(null);
  const [textLines, setTextLines] = useState<Box[]>([]);
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

  useEffect(() => {
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
  }, [blob]);

  const scale = bitmap ? Math.min(1, PREVIEW_MAX / bitmap.width) : 1;

  useEffect(() => {
    const el = canvas.current;
    if (!el || !bitmap) return;
    el.width = Math.round(bitmap.width * scale);
    el.height = Math.round(bitmap.height * scale);
    const ctx = el.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, el.width, el.height);
    drawBoxes(ctx, boxes, scale);
    if (draft) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(draft.x * scale, draft.y * scale, draft.w * scale, draft.h * scale);
    }
  }, [bitmap, boxes, draft, scale]);

  // 畫面上的座標換回原圖的像素
  const toImage = (e: PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * bitmap!.width, ((e.clientY - rect.top) / rect.height) * bitmap!.height];
  };

  const down = (e: PointerEvent) => {
    if (!bitmap || status !== "ready") return;
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    start.current = toImage(e);
  };
  const move = (e: PointerEvent) => {
    if (!start.current || !bitmap) return;
    const [x, y] = toImage(e);
    setDraft(boxFromPoints(start.current[0], start.current[1], x, y, bitmap.width, bitmap.height));
  };
  const up = (e: PointerEvent) => {
    if (!start.current || !bitmap) return;
    const [x, y] = toImage(e);
    const box = boxFromPoints(start.current[0], start.current[1], x, y, bitmap.width, bitmap.height);
    start.current = null;
    setDraft(null);
    if (isUsable(box, 4 / scale)) {
      setBoxes((list) => [...list, box]);
    } else {
      // 點一下已經框好的範圍就刪掉它
      setBoxes((list) => {
        let hit = -1;
        list.forEach((b, i) => {
          if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) hit = i;
        });
        return hit < 0 ? list : list.filter((_, i) => i !== hit);
      });
    }
  };

  // 找到的框加進去，跟已經有的框重疊的不重複加
  const addFound = (found: Box[]) => {
    const next = [...latest.current];
    for (const box of found) if (!next.some((b) => overlaps(b, box))) next.push(box);
    setBoxes(next);
    return next.length - latest.current.length;
  };

  const runAuto = async (kind: "faces" | "text") => {
    if (!bitmap) return;
    let detectError: (new () => Error) | undefined;
    setAuto({ kind, state: "running", n: 0 });
    try {
      const { findFaces, findText, NoWebGLError } = await import("./redact-detect.ts");
      detectError = NoWebGLError;
      if (kind === "faces") {
        const faces = await findFaces(bitmap);
        setAuto({ kind, state: "done", n: addFound(faces) || faces.length });
      } else {
        const { pii, lines } = await findText(bitmap);
        setTextLines(lines);
        setAuto({ kind, state: "done", n: addFound(pii.map((m) => m.box)) || pii.length });
      }
    } catch (e) {
      setAuto({ kind, state: detectError && e instanceof detectError ? "noWebgl" : "failed", n: 0 });
    }
  };

  const apply = async () => {
    if (!bitmap || !boxes.length) return;
    setStatus("working");
    try {
      const kept = keepExif ? exif : null;
      const out = await render(bitmap, boxes, format, kept);
      const report: Report = {
        removed: [{ code: "redaction", count: boxes.length }, { code: "reencode" }],
        kept: kept ? [{ code: "exif-kept" }] : [],
      };
      onDone(out, report);
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div class="redact">
      <p class="hint">{t("redact.help")}</p>
      {status === "loading" ? <p class="hint">{t("redact.loading")}</p> : null}
      {status === "decodeFailed" ? (
        <p class="error" role="alert">
          {t("redact.decodeFailed")}
        </p>
      ) : null}
      <div class="redact-auto">
        <button type="button" disabled={!bitmap || auto?.state === "running"} onClick={() => runAuto("faces")}>
          {t("redact.findFaces")}
        </button>
        <button type="button" disabled={!bitmap || auto?.state === "running"} onClick={() => runAuto("text")}>
          {t("redact.findText")}
        </button>
        {textLines.length ? (
          <button
            type="button"
            disabled={auto?.state === "running"}
            onClick={() => setAuto({ kind: "lines", state: "done", n: addFound(textLines) })}
          >
            {t("redact.findLines", { n: textLines.length })}
          </button>
        ) : null}
      </div>
      {auto ? (
        <p class={auto.state === "failed" || auto.state === "noWebgl" ? "error" : "hint"} role="status" data-testid="redact-auto-status">
          {auto.state === "noWebgl"
            ? t("redact.noWebgl")
            : auto.state === "running"
            ? t(auto.kind === "faces" ? "redact.findingFaces" : "redact.findingText")
            : auto.state === "failed"
              ? t("redact.findFailed")
              : auto.n
                ? t("redact.found", { n: auto.n })
                : t("redact.foundNone")}
        </p>
      ) : null}
      <canvas
        ref={canvas}
        class="redact-canvas"
        data-testid="redact-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          start.current = null;
          setDraft(null);
        }}
      />
      <p class="hint" aria-live="polite">
        {t("redact.count", { n: boxes.length })}
      </p>
      {exif ? (
        <label class="check">
          <input type="checkbox" checked={keepExif} onChange={(e) => setKeepExif((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            {t("redact.keepExif")}
            <small>{t("redact.keepExifNote")}</small>
          </span>
        </label>
      ) : null}
      <div class="buttons">
        <button type="button" class="primary" disabled={!boxes.length || status === "working"} onClick={apply}>
          {status === "working" ? t("redact.working") : t("redact.apply")}
        </button>
        <button type="button" disabled={!boxes.length} onClick={() => setBoxes((list) => list.slice(0, -1))}>
          {t("redact.undo")}
        </button>
        <button type="button" disabled={!boxes.length} onClick={() => setBoxes([])}>
          {t("redact.clear")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("redact.failed")}
        </p>
      ) : null}
      <p class="hint">{t("redact.autoNote")}</p>
      <p class="hint">{t("redact.note")}</p>
    </div>
  );
}

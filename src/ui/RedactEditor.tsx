import { useEffect, useRef, useState } from "preact/hooks";
import type { Format } from "../core/bytes.ts";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { type Box, boxFromPoints, isDark, isUsable, samplePoints } from "../tools/redact/index.ts";
import { decodeImage } from "./image-decode.ts";
import type { FileEditorProps } from "./types.ts";

// 編輯時畫面上的圖最多 1600 像素寬，框的座標一律存成原圖的像素
const PREVIEW_MAX = 1600;

function drawBoxes(ctx: CanvasRenderingContext2D, boxes: Box[], scale: number) {
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
}

// 原尺寸塗黑、重新編碼，再把輸出解碼回來抽查每個框，確認真的是黑的
async function render(bitmap: ImageBitmap, boxes: Box[], format: Format): Promise<Blob> {
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
  return blob;
}

export function RedactEditor({ blob, format, onDone, onCancel }: FileEditorProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [draft, setDraft] = useState<Box | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "decodeFailed">("loading");
  const start = useRef<[number, number] | null>(null);

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

  const apply = async () => {
    if (!bitmap || !boxes.length) return;
    setStatus("working");
    try {
      const out = await render(bitmap, boxes, format);
      const report: Report = { removed: [{ code: "redaction", count: boxes.length }, { code: "reencode" }], kept: [] };
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
      <p class="hint">{t("redact.note")}</p>
    </div>
  );
}

import { useEffect, useState } from "preact/hooks";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { LONG_EDGES, type LongEdge, QUALITY, downscaleSteps, targetSize } from "../tools/blend/index.ts";
import { trackFail } from "./analytics.ts";
import { assertCanvasReadable, isCanvasBlocked } from "./canvas-access.ts";
import { decodeImage } from "./image-decode.ts";
import type { FileEditorProps } from "./types.ts";
import { useWorking } from "./working.ts";

// 縮成常見尺寸並重新壓縮（src/tools/blend/）。輸出一律是 JPEG，中繼資料不會帶過去，
// 旋轉方向由解碼器套用在像素上。
async function blend(bitmap: ImageBitmap, longEdge: number): Promise<{ blob: Blob; resized: boolean }> {
  assertCanvasReadable();
  const target = targetSize(bitmap.width, bitmap.height, longEdge);
  let source: CanvasImageSource = bitmap;
  let canvas = document.createElement("canvas");
  const steps = downscaleSteps(bitmap.width, bitmap.height, target);
  if (!steps.length) steps.push(target);
  for (const step of steps) {
    canvas = document.createElement("canvas");
    canvas.width = step.width;
    canvas.height = step.height;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, step.width, step.height);
    ctx.drawImage(source, 0, 0, step.width, step.height);
    if (source instanceof HTMLCanvasElement) source.width = source.height = 0;
    source = canvas;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("encode");
  return { blob, resized: target.width !== bitmap.width };
}

export function BlendEditor({ blob, onDone, onCancel }: FileEditorProps) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [longEdge, setLongEdge] = useState<LongEdge>(LONG_EDGES[0]);
  const [status, setStatus] = useState<"loading" | "ready" | "working" | "failed" | "openFailed" | "canvasBlocked">("loading");
  useWorking(status === "working");

  useEffect(() => {
    let alive = true;
    void decodeImage(blob).then(
      (decoded) => {
        if (!alive) return decoded.close();
        setBitmap(decoded);
        setStatus("ready");
      },
      () => {
        trackFail("blend", "unsupported");
        if (alive) setStatus("openFailed");
      },
    );
    return () => {
      alive = false;
    };
  }, [blob]);
  useEffect(() => () => bitmap?.close(), [bitmap]);

  const apply = async () => {
    setStatus("working");
    try {
      const out = await blend(bitmap!, longEdge);
      const size = targetSize(bitmap!.width, bitmap!.height, longEdge);
      const removed: Report["removed"] = out.resized ? [{ code: "blend-resize", count: Math.max(size.width, size.height) }] : [];
      onDone(out.blob, { removed: [...removed, { code: "blend-reencode" }, { code: "reencode" }], kept: [] });
    } catch (error) {
      const blocked = isCanvasBlocked(error);
      trackFail("blend", blocked ? "canvas-blocked" : "broken");
      setStatus(blocked ? "canvasBlocked" : "failed");
    }
  };

  if (status === "openFailed") {
    return (
      <div class="blend">
        <p class="error" role="alert">
          {t("redact.decodeFailed")}
        </p>
        <div class="buttons">
          <button type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="blend">
      <p class="hint">{t("blend.intro")}</p>
      {bitmap ? (
        <p data-testid="blend-original">{t("blend.original", { w: bitmap.width, h: bitmap.height })}</p>
      ) : (
        <p class="hint">{t("printDots.loading")}</p>
      )}
      <fieldset class="choices">
        <legend>{t("blend.size")}</legend>
        {LONG_EDGES.map((edge) => {
          const size = bitmap ? targetSize(bitmap.width, bitmap.height, edge) : null;
          return (
            <label key={edge} class="check">
              <input type="radio" name="blend-size" checked={longEdge === edge} onChange={() => setLongEdge(edge)} />
              <span>
                {t("blend.edge", { n: edge })}
                {size ? (
                  <small class="hint">
                    {size.width === bitmap!.width ? t("blend.noResize") : t("blend.result", { w: size.width, h: size.height })}
                  </small>
                ) : null}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p class="hint">{t("blend.limits")}</p>
      <div class="buttons">
        <button type="button" class="primary" disabled={!bitmap || status === "working"} onClick={apply}>
          {status === "working" ? t("redact.working") : t("blend.apply")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
      {status === "failed" || status === "canvasBlocked" ? (
        <p class="error" role="alert">
          {t(status === "failed" ? "blend.failed" : "canvas.blocked")}
        </p>
      ) : null}
    </div>
  );
}

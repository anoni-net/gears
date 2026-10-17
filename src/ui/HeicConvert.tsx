import { useState } from "preact/hooks";
import type { Report } from "../core/tool.ts";
import { t } from "../i18n/index.ts";
import { decodeImage } from "./image-decode.ts";
import { trackFail } from "./analytics.ts";
import type { FileEditorProps } from "./types.ts";

// 把 HEIC 轉成 JPEG。iPhone 的照片傳到 Windows 或 Android 常常打不開，轉成 JPEG 到處都能看。
// 重新編碼時中繼資料不會帶過去，旋轉方向由解碼器套用在像素上。
async function toJpeg(blob: Blob): Promise<Blob> {
  const bitmap = await decodeImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!out) throw new Error("encode");
  return out;
}

export function HeicConvert({ blob, onDone, onCancel }: FileEditorProps) {
  const [status, setStatus] = useState<"idle" | "working" | "failed">("idle");
  const apply = async () => {
    setStatus("working");
    try {
      const report: Report = { removed: [{ code: "reencode" }], kept: [], notes: [{ code: "heic-converted" }] };
      onDone(await toJpeg(blob), report);
    } catch {
      trackFail("heic-to-jpeg", "unsupported");
      setStatus("failed");
    }
  };
  return (
    <div class="convert">
      <p class="hint">{t("heic.note")}</p>
      <div class="buttons">
        <button type="button" class="primary" disabled={status === "working"} onClick={apply}>
          {status === "working" ? t("heic.working") : t("heic.convert")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
      {status === "failed" ? (
        <p class="error" role="alert">
          {t("heic.failed")}
        </p>
      ) : null}
    </div>
  );
}

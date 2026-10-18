import { useEffect, useRef, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { QrContentView } from "./QrContentView.tsx";
import { track, trackFail } from "./analytics.ts";
import { isCanvasBlocked } from "./canvas-access.ts";
import { type Scanned, decodeCodeFromBlob, decodeCodeFromVideo } from "./qr-scan.ts";
import { wasmAvailable } from "./wasm.ts";
import { classify } from "../tools/qr-read/index.ts";
import samples from "../tools/qr-read/samples.json" with { type: "json" };

// 只記讀到哪一種格式，內容不送
const done = (found: Scanned) => {
  track("tool-done", { tool: "qr-read" });
  track("qr-read", { format: classify(found.text, found.format).kind });
};
import type { CreateToolProps } from "./types.ts";

// 相機畫面與照片都只在瀏覽器裡解讀。相機需要 HTTPS 才能使用。
export function QrReadTool({ onOpenTool }: CreateToolProps) {
  const [found, setFound] = useState<Scanned | null>(null);
  const [status, setStatus] = useState<"idle" | "scanning" | "reading" | "notFound" | "cameraError" | "canvasBlocked">("idle");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const cameraAvailable = typeof navigator.mediaDevices?.getUserMedia === "function" && window.isSecureContext;

  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(() => stop, []);

  useEffect(() => {
    if (status !== "scanning") return;
    let alive = true;
    const tick = async () => {
      if (!alive || !video.current) return;
      const result = await decodeCodeFromVideo(video.current);
      if (!alive) return;
      if (result) {
        stop();
        done(result);
        setFound(result);
        setStatus("idle");
      } else {
        setTimeout(tick, 250);
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [status]);

  const startCamera = async () => {
    setFound(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setStatus("scanning");
      // video 元素在 scanning 狀態才會畫出來，等下一輪再接上
      requestAnimationFrame(() => {
        if (video.current && stream.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      stop();
      setStatus("cameraError");
    }
  };

  const stopCamera = () => {
    stop();
    setStatus("idle");
  };

  // 範例跟讀者的照片走同一條路，只是不記使用統計
  const readBlob = async (blob: Blob, sample = false) => {
    stop();
    setFound(null);
    setStatus("reading");
    let result: Scanned | null;
    try {
      result = await decodeCodeFromBlob(blob);
    } catch (error) {
      if (!isCanvasBlocked(error)) throw error;
      if (!sample) trackFail("qr-read", "canvas-blocked");
      setStatus("canvasBlocked");
      return;
    }
    if (!sample) {
      if (result) done(result);
      else trackFail("qr-read", "not-found");
    }
    setFound(result);
    setStatus(result ? "idle" : "notFound");
    // 範例在畫面下方，讀完捲回結果
    if (sample) requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const readFile = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = "";
    if (file) void readBlob(file);
  };

  const readSample = async (id: string) => {
    const response = await fetch(sampleUrl(id));
    if (response.ok) await readBlob(await response.blob(), true);
  };

  return (
    <div class="qr-read">
      <div class="buttons" ref={top}>
        {cameraAvailable ? (
          status === "scanning" ? (
            <button type="button" onClick={stopCamera}>
              {t("qrread.stop")}
            </button>
          ) : (
            <button type="button" class="primary" onClick={startCamera}>
              {t("qrread.camera")}
            </button>
          )
        ) : null}
        <button type="button" class={cameraAvailable ? "" : "primary"} onClick={() => input.current?.click()}>
          {t("qrread.photo")}
        </button>
        <input ref={input} type="file" accept="image/*" hidden onChange={readFile} data-testid="qr-input" />
      </div>
      {!cameraAvailable ? <p class="hint">{t("qrread.noCamera")}</p> : null}
      {!wasmAvailable() ? <p class="hint">{t("qrread.noWasm")}</p> : null}

      {status === "scanning" ? <video ref={video} class="camera" playsInline muted aria-label={t("qrread.camera")} /> : null}
      {status === "reading" ? <p class="hint">{t("qrread.reading")}</p> : null}
      {status === "notFound" ? (
        <p class="error" role="alert">
          {t("qrread.notFound")}
        </p>
      ) : null}
      {status === "canvasBlocked" ? (
        <p class="error" role="alert">
          {t("canvas.blocked")}
        </p>
      ) : null}
      {status === "cameraError" ? (
        <p class="error" role="alert">
          {t("qrread.cameraError")}
        </p>
      ) : null}

      {found ? <QrContentView text={found.text} format={found.format} onOpenTool={onOpenTool} /> : null}
      <p class="hint">{t("qrread.privacy")}</p>
      <QrSamples onRead={readSample} />
    </div>
  );
}

const sampleUrl = (id: string) => `${import.meta.env.BASE_URL}samples/qr/${id}.png`;
const GROUPS = ["share", "check", "connect", "everyday"] as const;

// 範例：手邊沒有條碼也能試，展示時也用得到。圖片由 scripts/make-qr-samples.mjs 照
// samples.json 在建置前產生，內容都是假的。點一下就用那張圖讀取，圖片也可以讓另一支
// 手機的相機掃。預設收起來，讀者自己的照片才是主要的入口
function QrSamples({ onRead }: { onRead(id: string): void }) {
  return (
    <details class="qr-samples">
      <summary>{t("qrread.samples")}</summary>
      <p class="hint">{t("qrread.samples.hint")}</p>
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`qr-samples-${group}`}>
          <h3 id={`qr-samples-${group}`}>{tDynamic(`qrread.samples.${group}`)}</h3>
          <ul>
            {samples
              .filter((s) => s.group === group)
              .map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => onRead(s.id)} data-sample={s.id}>
                    <img src={sampleUrl(s.id)} alt="" loading="lazy" />
                    <span>{tDynamic(`qrread.sample.${s.id}`)}</span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </details>
  );
}

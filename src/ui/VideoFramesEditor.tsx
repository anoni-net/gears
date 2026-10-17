import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { tray } from "../state.ts";
import { clock, frameName } from "../tools/video-frames/index.ts";
import { track, trackFail } from "./analytics.ts";
import { canvasReadable } from "./canvas-access.ts";
import type { FileEditorProps } from "./types.ts";
import { type Frame, extractFrames, openVideo } from "./video-frames.ts";
import { useWorking } from "./working.ts";

type Status =
  | { kind: "opening" }
  | { kind: "scanning"; progress: number }
  | { kind: "capturing"; done: number; total: number }
  | { kind: "ready"; evenly: boolean }
  | { kind: "unplayable" }
  | { kind: "canvasBlocked" }
  | { kind: "failed" };

// 影片的關鍵影格：打開就掃過整部影片，挑出畫面明顯不同的幾格（src/tools/video-frames/），
// 讀者勾選之後加進暫存區，拿去做反向圖片搜尋。用哪個搜尋服務由讀者自己決定，這裡不連到任何服務。
export function VideoFramesEditor({ blob, onCancel }: FileEditorProps) {
  const [status, setStatus] = useState<Status>({ kind: "opening" });
  const [frames, setFrames] = useState<(Frame & { url: string })[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // 讀者按了「再試一次」才重新掃描，Tor Browser 要在點擊之後讀取 canvas 才會跳出詢問
  const [attempt, setAttempt] = useState(0);
  useWorking(status.kind === "scanning" || status.kind === "capturing");

  useEffect(() => {
    if (!canvasReadable()) {
      trackFail("video-frames", "canvas-blocked");
      setStatus({ kind: "canvasBlocked" });
      return;
    }
    const abort = new AbortController();
    let close = () => {};
    const urls: string[] = [];
    void (async () => {
      setStatus({ kind: "opening" });
      try {
        const opened = await openVideo(blob);
        close = opened.close;
        if (abort.signal.aborted) return close();
        setStatus({ kind: "scanning", progress: 0 });
        const { frames: extracted, evenly } = await extractFrames(
          opened.video,
          opened.duration,
          (p) => setStatus(p.step === "scan" ? { kind: "scanning", progress: p.ratio } : { kind: "capturing", done: p.done - 1, total: p.total }),
          abort.signal,
        );
        if (abort.signal.aborted) return close();
        const out = extracted.map((frame) => {
          const url = URL.createObjectURL(frame.blob);
          urls.push(url);
          return { ...frame, url };
        });
        close();
        setFrames(out);
        setSelected(new Set(out.map((_, i) => i)));
        setStatus({ kind: "ready", evenly });
      } catch (error) {
        close();
        if (abort.signal.aborted) return;
        const unplayable = (error as Error)?.message === "video-unplayable";
        trackFail("video-frames", unplayable ? "unsupported" : "broken");
        setStatus({ kind: unplayable ? "unplayable" : "failed" });
      }
    })();
    return () => {
      abort.abort();
      close();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [blob, attempt]);

  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  // 加進暫存區之後，暫存區會切到第一張圖片，讀者接著可以遮蔽或下載
  const addToTray = () => {
    const picked = frames.filter((_, i) => selected.has(i));
    track("tool-done", { tool: "video-frames" });
    void tray.add(
      picked.map((f) => new File([f.blob], frameName(f.time), { type: "image/jpeg" })),
      "video-frames",
    );
  };

  const message = (() => {
    switch (status.kind) {
      case "opening":
        return t("frames.opening");
      case "scanning":
        return t("frames.scanning", { n: Math.round(status.progress * 100) });
      case "capturing":
        return t("frames.capturing", { n: status.done + 1, total: status.total });
      case "ready":
        return status.evenly ? t("frames.evenly", { n: frames.length }) : t("frames.found", { n: frames.length });
      case "unplayable":
        return t("frames.unplayable");
      case "canvasBlocked":
        return t("canvas.blocked");
      case "failed":
        return t("frames.failed");
    }
  })();
  const error = status.kind === "unplayable" || status.kind === "canvasBlocked" || status.kind === "failed";

  return (
    <div class="video-frames">
      <p class="hint">{t("frames.intro")}</p>
      {/* 適合哪些影片：挑法是比對整張畫面的變化，剪輯過的影片效果好，監視器這類只有一小塊在動的挑不到 */}
      <details class="verify-details">
        <summary>{t("frames.when")}</summary>
        <p>{t("frames.when.good")}</p>
        <p>{t("frames.when.bad")}</p>
        <p>{t("frames.when.how")}</p>
      </details>
      <p class={error ? "error" : "hint"} role="status" data-testid="frames-status">
        {message}
      </p>
      {frames.length ? (
        <ul class="page-grid" data-testid="frames">
          {frames.map((frame, index) => (
            <li key={frame.time} class={selected.has(index) ? "page-card checked" : "page-card"}>
              <label class="page-pick">
                <img src={frame.url} alt={t("frames.alt", { time: clock(frame.time) })} width={frame.width} height={frame.height} />
                <span>
                  <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                  {clock(frame.time)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {status.kind === "ready" ? <p class="hint">{t("frames.searchNote")}</p> : null}
      <div class="buttons">
        {status.kind === "canvasBlocked" ? (
          <button
            type="button"
            class="primary"
            onClick={() => {
              // 在點擊的當下讀一次，Tor Browser 才會在網址列跳出詢問
              canvasReadable();
              setAttempt((n) => n + 1);
            }}
          >
            {t("frames.retry")}
          </button>
        ) : (
          <button type="button" class="primary" disabled={status.kind !== "ready" || !selected.size} onClick={addToTray}>
            {t("frames.toTray", { n: selected.size })}
          </button>
        )}
        <button type="button" onClick={onCancel}>
          {t("redact.cancel")}
        </button>
      </div>
    </div>
  );
}

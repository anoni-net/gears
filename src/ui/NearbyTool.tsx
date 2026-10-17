import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { routeUrl } from "../router.ts";
import { tray } from "../state.ts";
import { CodecError, decode, fromText, offerTag } from "../tools/nearby/codec.ts";
import { MAX_TOTAL, type FileMeta } from "../tools/nearby/protocol.ts";
import { MARGIN, encodeQr, qrPath } from "../tools/qrcode/index.ts";
import { track, trackFail } from "./analytics.ts";
import { useTray } from "./hooks.ts";
import {
  ConnectTimeoutError,
  type Incoming,
  NoNetworkError,
  type Pending,
  TooLargeError,
  answerOffer,
  applyAnswer,
  close,
  confirmOf,
  createOffer,
  opened,
  receiveFiles,
  rtcAvailable,
  sendFiles,
} from "./nearby.ts";
import { outputName } from "./output-name.ts";
import { decodeQrFromVideo } from "./qr-scan.ts";
import type { CreateToolProps } from "./types.ts";
import { useWorking } from "./working.ts";

type Phase =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "offering" } // 送出端：顯示 QR code，等回應
  | { kind: "scanning" } // 接收端：掃送出端的 QR code
  | { kind: "answering" } // 接收端：顯示回應的 QR code，等連上
  | { kind: "connecting" }
  | { kind: "review"; incoming: Incoming }
  | { kind: "awaiting" } // 送出端：連上了，計算 SHA-256、等對方決定要不要接收
  | { kind: "transfer"; done: number; total: number }
  | { kind: "sent"; ok: boolean[] }
  | { kind: "declined" }
  | { kind: "received"; count: number; failed: number }
  | { kind: "error"; reason: "timeout" | "closed" | "tooLarge" | "noNetwork" | "failed" };

const size = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function QrCode({ text, label }: { text: string; label: string }) {
  const matrix = encodeQr(text, "M");
  return (
    <svg class="qr-preview" role="img" aria-label={label} viewBox={`0 0 ${matrix.size + MARGIN * 2} ${matrix.size + MARGIN * 2}`} shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={qrPath(matrix)} fill="#000" />
    </svg>
  );
}

const cameraSupported = () => typeof navigator.mediaDevices?.getUserMedia === "function" && window.isSecureContext;

// 開相機。連線描述要在開相機之後才建立：取得相機權限之後，Chrome 與 Safari 才會交出區網位址，
// 只交 mDNS 名稱的話，網路不支援 mDNS 時兩邊都連不上（anoni-net/docs#553 的實機測試遇過）。
// 至少一邊交出區網位址，另一邊就連得到。沒有相機或讀者不允許時回傳 null，改用複製貼上
async function openCamera(): Promise<MediaStream | null> {
  if (!cameraSupported()) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    return null;
  }
}

// 用已經開好的相機一直掃，掃到的文字交給 onCode。onCode 回傳 false 表示不是要的代碼，繼續掃
function useScanner(stream: MediaStream | null, active: boolean, onCode: (text: string) => boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;
  useEffect(() => {
    if (!stream || !active) return;
    let alive = true;
    let timer = 0;
    requestAnimationFrame(() => {
      if (!video.current) return;
      video.current.srcObject = stream;
      void video.current.play().catch(() => {});
    });
    const tick = async () => {
      if (!alive) return;
      const found = video.current?.videoWidth ? await decodeQrFromVideo(video.current).catch(() => null) : null;
      if (found && handler.current(found)) return;
      timer = window.setTimeout(tick, 250);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [stream, active]);
  return video;
}

// 傳送的時候不讓螢幕關掉，手機鎖屏之後連線可能斷掉
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    void navigator.wakeLock.request("screen").then((l) => (alive ? (lock = l) : void l.release()), () => {});
    return () => {
      alive = false;
      void lock?.release();
    };
  }, [active]);
}

// 面對面傳送：兩台裝置在同一個網路裡，用 WebRTC 直接傳暫存區的檔案，不經過任何伺服器。
// 連線描述用 QR code 交換：送出端的 QR code 是工作台的網址，連線描述放在 # 後面（不會送到伺服器），
// 手機用系統的相機掃也能直接打開。接收端的回應由送出端頁面裡的相機掃。沒有相機時複製貼上
export function NearbyTool(_props: CreateToolProps) {
  const state = useTray();
  const [mode, setMode] = useState<"choose" | "send" | "receive">("choose");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // 要送出的檔案：預設全選，打開工具之後才加入暫存區的檔案也勾上（seen 記著已經處理過的檔案）
  const [picked, setPicked] = useState<Set<number>>(() => new Set(state.files.map((f) => f.id)));
  const seen = useRef(new Set(state.files.map((f) => f.id)));
  useEffect(() => {
    const added = state.files.filter((f) => !seen.current.has(f.id)).map((f) => f.id);
    if (!added.length) return;
    for (const id of added) seen.current.add(id);
    setPicked((s) => new Set([...s, ...added]));
  }, [state.files]);
  // 檔名預設跟下載一樣改成 gears 加編號，原本的檔名常帶著日期或人名。傳給自己的其他裝置時可以保留
  const [keepNames, setKeepNames] = useState(false);
  const nameOf = (f: (typeof state.files)[number]) => (keepNames ? f.name : outputName(f, state.files.indexOf(f)));
  const [code, setCode] = useState(""); // 自己這一側要給對方的代碼
  const [confirm, setConfirm] = useState("");
  const [pasted, setPasted] = useState("");
  const [notCode, setNotCode] = useState(false);
  const pending = useRef<Pending | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const stopCamera = () =>
    setStream((s) => {
      s?.getTracks().forEach((track) => track.stop());
      return null;
    });
  const startCamera = async () => {
    const s = await openCamera();
    setStream(s);
    setCameraDenied(!s);
  };
  const busy = phase.kind === "connecting" || phase.kind === "transfer" || phase.kind === "preparing" || phase.kind === "awaiting";
  useWorking(busy || phase.kind === "offering" || phase.kind === "answering");
  useWakeLock(busy || phase.kind === "offering" || phase.kind === "answering" || phase.kind === "review");

  useEffect(
    () => () => {
      close(pending.current);
      stopCamera();
    },
    [],
  );

  // 從送出端的 QR code 打開時，網址的 # 後面是連線描述。讀完就從網址清掉，不留在瀏覽紀錄裡。
  // 頁面已經開著、只有 # 後面換了的時候瀏覽器不會重新載入，另外聽 hashchange
  const fromHash = useRef<() => void>(() => {});
  fromHash.current = () => {
    const hash = location.hash.slice(1);
    if (!hash || !rtcAvailable()) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    if (phase.kind !== "idle" && phase.kind !== "scanning") return; // 正在配對或傳送時不打斷
    close(pending.current);
    setMode("receive");
    void receive(hash);
  };
  useEffect(() => {
    fromHash.current();
    const onHash = () => fromHash.current();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const fail = (error: unknown) => {
    close(pending.current);
    pending.current = null;
    const reason =
      error instanceof ConnectTimeoutError ? "timeout"
      : error instanceof NoNetworkError ? "noNetwork"
      : error instanceof TooLargeError ? "tooLarge"
      : (error as Error)?.message === "closed" ? "closed"
      : "failed";
    trackFail("nearby", reason === "timeout" || reason === "noNetwork" ? "network" : reason === "tooLarge" ? "too-large" : "other");
    setPhase({ kind: "error", reason });
  };

  // ── 送出端 ──
  const files = state.files.filter((f) => picked.has(f.id));
  const startSend = async () => {
    setPhase({ kind: "preparing" });
    try {
      await startCamera();
      const p = await createOffer();
      pending.current = p;
      setCode(new URL(`${routeUrl("nearby")}#${p.code}`, location.href).href);
      setPhase({ kind: "offering" });
    } catch (error) {
      fail(error);
    }
  };
  // 掃到或貼上的文字先同步檢查是不是這一次配對的回應，不是的話繼續掃
  const gotAnswer = (text: string): boolean => {
    const p = pending.current;
    if (!p || phase.kind !== "offering") return false;
    try {
      const d = decode(fromText(text));
      if (!d.answer || d.tag !== offerTag(p.local.ufrag)) throw new CodecError("不是這一次配對的回應");
    } catch {
      setNotCode(true);
      return false;
    }
    setNotCode(false);
    void (async () => {
      await applyAnswer(p, text);
      setPhase({ kind: "connecting" });
      const link = await opened(p);
      setConfirm(confirmOf(p));
      setPhase({ kind: "awaiting" });
      const outgoing = files.map((f) => ({ name: nameOf(f), blob: f.versions.at(-1)!.blob }));
      const result = await sendFiles(link, outgoing, (done, total) => setPhase({ kind: "transfer", done, total }));
      if (result.declined) return setPhase({ kind: "declined" });
      track("tool-done", { tool: "nearby" });
      setPhase({ kind: "sent", ok: result.ok });
    })().catch(fail);
    return true;
  };

  // ── 接收端 ──
  const receive = async (text: string): Promise<boolean> => {
    try {
      setPhase({ kind: "preparing" });
      const p = await answerOffer(text);
      pending.current = p;
      setCode(p.code);
      setPhase({ kind: "answering" });
      setNotCode(false);
      const link = await opened(p);
      setConfirm(confirmOf(p));
      setPhase({ kind: "connecting" });
      const incoming = await receiveFiles(link);
      setPhase({ kind: "review", incoming });
      return true;
    } catch (error) {
      if (error instanceof CodecError) {
        setNotCode(true);
        setPhase({ kind: "scanning" });
        return false;
      }
      fail(error);
      return true;
    }
  };
  const accept = async (incoming: Incoming) => {
    setPhase({ kind: "transfer", done: 0, total: incoming.files.reduce((s, f) => s + f.size, 0) });
    try {
      const result = await incoming.accept((done, total) => setPhase({ kind: "transfer", done, total }));
      if (result.files.length) await tray.add(result.files, "nearby");
      track("tool-done", { tool: "nearby" });
      close(pending.current);
      setPhase({ kind: "received", count: result.files.length, failed: result.ok.filter((ok) => !ok).length });
    } catch (error) {
      fail(error);
    }
  };

  const scanning = (mode === "send" && phase.kind === "offering") || (mode === "receive" && phase.kind === "scanning");
  const gotOffer = (text: string): boolean => {
    try {
      if (decode(fromText(text)).answer) throw new CodecError("這是回應，不是發起");
    } catch {
      setNotCode(true);
      return false;
    }
    void receive(text);
    return true;
  };
  const scanner = useScanner(stream, scanning, (text) => (mode === "send" ? gotAnswer(text) : gotOffer(text)));
  // 掃完就關相機。接收端的回應在相機還開著時建立，送出端的發起也是，見 openCamera
  useEffect(() => {
    if (!scanning && phase.kind !== "preparing") stopCamera();
  }, [scanning, phase.kind]);

  const restart = () => {
    stopCamera();
    close(pending.current);
    pending.current = null;
    setPhase({ kind: "idle" });
    setMode("choose");
    setCode("");
    setConfirm("");
    setPasted("");
    setNotCode(false);
  };

  if (!rtcAvailable()) {
    return (
      <div class="nearby">
        <p class="error" role="alert">
          {t("nearby.noRtc")}
        </p>
      </div>
    );
  }

  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      () => {},
    );

  // 貼上對方代碼的欄位，沒有相機時用
  const pasteBox = (onSubmit: (text: string) => void, label: string) => (
    <form
      class="nearby-paste"
      onSubmit={(e) => {
        e.preventDefault();
        if (pasted.trim()) onSubmit(pasted.trim());
      }}
    >
      <label for="nearby-paste">{label}</label>
      <textarea id="nearby-paste" rows={2} value={pasted} onInput={(e) => setPasted(e.currentTarget.value)} spellcheck={false} autocomplete="off" data-testid="nearby-paste" />
      <div class="buttons">
        <button type="submit">{t("nearby.pasteApply")}</button>
      </div>
    </form>
  );

  // 自己這一側的 QR code，沒有相機時展開複製代碼
  const myCode = (label: string) =>
    code ? (
      <div class="nearby-code">
        <QrCode text={code} label={label} />
        <details>
          <summary>{t("nearby.noCamera")}</summary>
          <p class="hint">{t("nearby.copyNote")}</p>
          <textarea readOnly rows={3} value={code} aria-label={label} data-testid="nearby-code" />
          <div class="buttons">
            <button type="button" onClick={copy}>
              {copied ? t("nearby.copied") : t("nearby.copy")}
            </button>
          </div>
        </details>
      </div>
    ) : null;

  const camera = scanning ? (
    <>
      {stream ? <video ref={scanner} class="camera" playsInline muted aria-label={t("nearby.camera")} /> : null}
      {cameraDenied ? <p class="hint">{t("nearby.cameraDenied")}</p> : null}
      {notCode ? <p class="error">{t("nearby.notCode")}</p> : null}
    </>
  ) : null;

  const status = (() => {
    switch (phase.kind) {
      case "preparing":
        return t("nearby.preparing");
      case "offering":
        return t("nearby.offering");
      case "answering":
        return t("nearby.answering");
      case "connecting":
        return t("nearby.connecting");
      case "awaiting":
        return t("nearby.awaiting");
      case "transfer":
        return t("nearby.transfer", { done: size(phase.done), total: size(phase.total), n: Math.round((phase.done / Math.max(1, phase.total)) * 100) });
      case "sent":
        return phase.ok.every(Boolean) ? t("nearby.sent", { n: phase.ok.length }) : t("nearby.sentPartly", { n: phase.ok.filter((ok) => !ok).length });
      case "declined":
        return t("nearby.declined");
      case "received":
        return phase.failed ? t("nearby.receivedPartly", { n: phase.count, m: phase.failed }) : t("nearby.received", { n: phase.count });
      case "error":
        return t(`nearby.error.${phase.reason}`);
      default:
        return "";
    }
  })();

  // 每個畫面最下面只有一列按鈕：主要的動作在前，取消或重新開始在後
  const cancel = (
    <button type="button" onClick={restart}>
      {["sent", "received", "declined", "error"].includes(phase.kind) ? t("nearby.again") : t("redact.cancel")}
    </button>
  );

  let body = null;
  let actions = null;
  if (mode === "choose") {
    body = !state.files.length ? <p class="hint">{t("nearby.emptyTray")}</p> : null;
    actions = (
      <>
        <button type="button" class="primary" disabled={!state.files.length} onClick={() => setMode("send")}>
          {t("nearby.send")}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("receive");
            setPhase({ kind: "preparing" });
            void startCamera().then(() => setPhase({ kind: "scanning" }));
          }}
        >
          {t("nearby.receive")}
        </button>
      </>
    );
  } else if (mode === "send" && phase.kind === "idle") {
    body = (
      <>
        <fieldset class="choices">
          <legend>{t("nearby.pick")}</legend>
          {state.files.map((f) => (
            <label key={f.id} class="check">
              <input
                type="checkbox"
                checked={picked.has(f.id)}
                onChange={() => setPicked((s) => (s.has(f.id) ? new Set([...s].filter((x) => x !== f.id)) : new Set([...s, f.id])))}
              />
              <span>
                {nameOf(f)}
                <small class="hint">{size(f.versions.at(-1)!.blob.size)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <label class="check">
          <input type="checkbox" checked={keepNames} onChange={(e) => setKeepNames(e.currentTarget.checked)} data-testid="nearby-keep-names" />
          <span>
            {t("nearby.keepNames")}
            <small class="hint">{t("nearby.keepNamesNote")}</small>
          </span>
        </label>
      </>
    );
    actions = (
      <>
        <button type="button" class="primary" disabled={!files.length} onClick={() => void startSend()}>
          {t("nearby.start", { n: files.length })}
        </button>
        {cancel}
      </>
    );
  } else if (mode === "send" && phase.kind === "offering") {
    body = (
      <div class="nearby-pair">
        {myCode(t("nearby.qrOffer"))}
        <div>
          <p>{t("nearby.scanAnswer")}</p>
          {camera}
          {pasteBox((text) => void gotAnswer(text), t("nearby.pasteAnswer"))}
        </div>
      </div>
    );
    actions = cancel;
  } else if (mode === "receive" && phase.kind === "scanning") {
    body = (
      <>
        <p>{t("nearby.scanOffer")}</p>
        {camera}
        {pasteBox((text) => void gotOffer(text), t("nearby.pasteOffer"))}
      </>
    );
    actions = cancel;
  } else if (mode === "receive" && phase.kind === "answering") {
    body = myCode(t("nearby.qrAnswer"));
    actions = cancel;
  } else if (phase.kind === "review") {
    const total = phase.incoming.files.reduce((sum, f: FileMeta) => sum + f.size, 0);
    body = (
      <div class="nearby-review">
        <p>{t("nearby.incoming", { n: phase.incoming.files.length, total: size(total) })}</p>
        <ul data-testid="nearby-incoming">
          {phase.incoming.files.map((f, i) => (
            <li key={i}>
              {f.name} <small class="hint">{size(f.size)}</small>
            </li>
          ))}
        </ul>
        {total > MAX_TOTAL ? <p class="error">{t("nearby.error.tooLarge")}</p> : null}
        <p class="hint">{t("nearby.confirmNote")}</p>
      </div>
    );
    actions = (
      <>
        <button type="button" class="primary" onClick={() => void accept(phase.incoming)}>
          {t("nearby.accept")}
        </button>
        <button
          type="button"
          onClick={() => {
            phase.incoming.decline();
            setPhase({ kind: "declined" });
          }}
        >
          {t("nearby.decline")}
        </button>
      </>
    );
  } else if (phase.kind === "transfer") {
    body = <progress max={phase.total} value={phase.done} />;
  } else if (!busy) {
    actions = cancel;
  }

  return (
    <div class="nearby">
      {status ? (
        <p class={phase.kind === "error" ? "error" : "hint"} role="status" data-testid="nearby-status">
          {status}
        </p>
      ) : null}
      {confirm && phase.kind !== "error" ? (
        <p data-testid="nearby-confirm">
          {t("nearby.confirm")} <strong>{confirm}</strong>
        </p>
      ) : null}
      {body}
      {actions ? <div class="buttons nearby-actions">{actions}</div> : null}
    </div>
  );
}

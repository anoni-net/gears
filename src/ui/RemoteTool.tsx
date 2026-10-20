import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { routeUrl } from "../router.ts";
import { IS_ONION } from "../site.ts";
import { tray } from "../state.ts";
import { type FileMeta, MAX_TOTAL } from "../tools/nearby/protocol.ts";
import { type Incoming, TooLargeError, receiveFiles, sendFiles } from "../tools/nearby/transfer.ts";
import { type Invite, inviteHash, onionLink, parseInvite } from "../tools/remote/invite.ts";
import { RelayError, RelayLink } from "../tools/remote/relay-client.ts";
import { SecureError, newLinkKey } from "../tools/remote/secure.ts";
import { RemoteSession, type SessionState } from "../tools/remote/session.ts";
import { track, trackFail } from "./analytics.ts";
import { useTray } from "./hooks.ts";
import { size, useOutgoing, useWakeLock } from "./transfer-ui.tsx";
import type { CreateToolProps } from "./types.ts";
import { useWorking } from "./working.ts";

type Reason = "noRoom" | "wrongKey" | "gone" | "busy" | "rateLimited" | "version" | "connect" | "quota" | "tooLarge" | "failed";

type Phase =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "sharing"; link: string; onion: string } // 送出端：連結給對方，等對方加入
  | { kind: "invited"; invite: Invite } // 接收端：打開了連結，按「加入」才連線
  | { kind: "connecting" }
  | { kind: "awaiting" } // 送出端：連上了，等對方決定要不要接收
  | { kind: "review"; incoming: Incoming }
  | { kind: "transfer"; done: number; total: number }
  | { kind: "sent"; ok: boolean[] }
  | { kind: "declined" }
  | { kind: "received"; count: number; failed: number }
  | { kind: "error"; reason: Reason };

// 轉送服務跟網頁在同一個網域（clearnet 的 /gears/relay/、onion 的 /relay/），CSP 的 'self' 就涵蓋
function relayUrl(): string {
  const url = new URL(`${import.meta.env.BASE_URL}relay/`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function reasonOf(error: unknown): Reason {
  if (error instanceof TooLargeError) return "tooLarge";
  if (error instanceof SecureError) return error.code === "version" ? "version" : error.code === "wrong-key" ? "wrongKey" : "failed";
  if (error instanceof RelayError) {
    switch (error.code) {
      case "no-room":
      case "room-full":
        return "noRoom";
      case "gone":
      case "closed":
        return "gone";
      case "busy":
        return "busy";
      case "rate-limited":
        return "rateLimited";
      case "version":
        return "version";
      case "connect":
        return "connect";
      case "quota":
        return "quota";
    }
  }
  return "failed";
}

// 遠端傳送：對方不在身邊時，產生一個連結交給對方，經過社群的轉送服務傳暫存區的檔案（anoni-net/gears#104）。
// 連結的 # 後面是房間代碼與連結金鑰，不會送到伺服器。兩端之間加密（secure.ts），斷線接回來之後
// 從斷掉的地方接著傳（session.ts）。伺服器不保存檔案，兩端要同時開著頁面
export function RemoteTool(_props: CreateToolProps) {
  const state = useTray();
  const out = useOutgoing(state);
  const [mode, setMode] = useState<"choose" | "send" | "receive">("choose");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [confirm, setConfirm] = useState("");
  const [conn, setConn] = useState<SessionState | null>(null);
  const [pasted, setPasted] = useState("");
  const [notLink, setNotLink] = useState(false);
  const [copied, setCopied] = useState("");
  const session = useRef<RemoteSession | null>(null);
  // 傳完之後對方關掉連線是正常的，不當成錯誤
  const finished = useRef(false);

  const busy = phase.kind === "creating" || phase.kind === "connecting" || phase.kind === "awaiting" || phase.kind === "transfer";
  const open = busy || phase.kind === "sharing" || phase.kind === "review";
  useWorking(open);
  useWakeLock(open);

  useEffect(() => {
    // 手機切回前景時馬上接回去，不等下一次重試
    const onVisible = () => {
      if (document.visibilityState === "visible") session.current?.reconnectNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      session.current?.close();
    };
  }, []);

  // 從分享連結打開時讀 # 後面，讀完就從網址清掉，不留在瀏覽紀錄裡。不自動連線：通訊軟體的預覽
  // 可能在伺服器端打開連結，自動加入的話一次性的房間會先被用掉，讀者按「加入」才連
  const fromHash = useRef<() => void>(() => {});
  fromHash.current = () => {
    const invite = parseInvite(location.hash);
    if (!invite) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    if (phase.kind !== "idle" && phase.kind !== "invited") return;
    setMode("receive");
    setPhase({ kind: "invited", invite });
  };
  useEffect(() => {
    fromHash.current();
    const onHash = () => fromHash.current();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const fail = (error: unknown) => {
    if (finished.current) return;
    session.current?.close();
    session.current = null;
    const reason = reasonOf(error);
    trackFail("remote", reason === "connect" ? "network" : reason === "tooLarge" ? "too-large" : "other");
    setPhase({ kind: "error", reason });
  };

  const watch = (s: RemoteSession) => {
    session.current = s;
    finished.current = false;
    s.onState(setConn);
    void s.confirm.then(setConfirm, () => {});
  };

  const done = (next: Phase) => {
    finished.current = true;
    session.current?.close();
    session.current = null;
    setConn(null);
    setPhase(next);
  };

  // ── 送出端 ──
  const startSend = async () => {
    setPhase({ kind: "creating" });
    try {
      const link = await RelayLink.open(relayUrl());
      const invite = { room: link.room, key: newLinkKey() };
      const s = new RemoteSession(link, invite.key, "opener");
      watch(s);
      const route = routeUrl("remote");
      setPhase({
        kind: "sharing",
        link: new URL(`${route}#${inviteHash(invite)}`, location.href).href,
        onion: IS_ONION ? "" : onionLink(route.slice(import.meta.env.BASE_URL.length), invite),
      });
      await link.paired;
      setPhase({ kind: "connecting" });
      await s.confirm;
      setPhase({ kind: "awaiting" });
      const result = await sendFiles(s, out.outgoing(), (sent, total) => setPhase({ kind: "transfer", done: sent, total }));
      if (result.declined) return done({ kind: "declined" });
      track("tool-done", { tool: "remote" });
      done({ kind: "sent", ok: result.ok });
    } catch (error) {
      fail(error);
    }
  };

  // ── 接收端 ──
  const join = async (invite: Invite) => {
    setPhase({ kind: "connecting" });
    try {
      const link = await RelayLink.join(relayUrl(), invite.room);
      const s = new RemoteSession(link, invite.key, "joiner");
      watch(s);
      await s.confirm;
      const incoming = await receiveFiles(s);
      setPhase({ kind: "review", incoming });
    } catch (error) {
      fail(error);
    }
  };
  const accept = async (incoming: Incoming) => {
    setPhase({ kind: "transfer", done: 0, total: incoming.files.reduce((s, f) => s + f.size, 0) });
    try {
      const result = await incoming.accept((received, total) => setPhase({ kind: "transfer", done: received, total }));
      if (result.files.length) await tray.add(result.files, "remote");
      track("tool-done", { tool: "remote" });
      done({ kind: "received", count: result.files.length, failed: result.ok.filter((ok) => !ok).length });
    } catch (error) {
      fail(error);
    }
  };

  const restart = () => {
    session.current?.close();
    session.current = null;
    finished.current = false;
    setConn(null);
    setConfirm("");
    setPasted("");
    setNotLink(false);
    setCopied("");
    setPhase({ kind: "idle" });
    setMode("choose");
  };

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => setCopied(text),
      () => {},
    );

  const privacy = (
    <div class="remote-privacy" data-testid="remote-privacy">
      <p>
        <strong>{t("remote.privacy.title")}</strong>
      </p>
      <p>{t(IS_ONION ? "remote.privacy.onion" : "remote.privacy.clearnet")}</p>
      <details>
        <summary>{t("remote.privacy.more")}</summary>
        <ul>
          <li>{t("remote.privacy.sees")}</li>
          <li>{t("remote.privacy.keeps")}</li>
          <li>{t("remote.privacy.link")}</li>
          <li>{t("remote.privacy.limits")}</li>
        </ul>
      </details>
    </div>
  );

  const linkBox = (link: string, label: string, testid: string) => (
    <div class="remote-link">
      <label for={testid}>{label}</label>
      <textarea id={testid} readOnly rows={3} value={link} data-testid={testid} />
      <div class="buttons">
        <button type="button" onClick={() => copy(link)}>
          {copied === link ? t("remote.copied") : t("remote.copy")}
        </button>
        {typeof navigator.share === "function" ? (
          <button type="button" onClick={() => void navigator.share({ url: link }).catch(() => {})}>
            {t("remote.shareButton")}
          </button>
        ) : null}
      </div>
    </div>
  );

  const status = (() => {
    switch (phase.kind) {
      case "creating":
        return t("remote.creating");
      case "sharing":
        return t("remote.waiting");
      case "invited":
        return t("remote.invite");
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
        return t(`remote.error.${phase.reason}`);
      default:
        return "";
    }
  })();

  // 連上之後的連線狀態：自己斷線正在接回去，或對方暫時離線
  const live = open && phase.kind !== "creating";
  const connNote = live && conn === "reconnecting" ? t("remote.reconnecting") : live && conn === "peer-away" ? t("remote.peerAway") : "";

  const cancel = (
    <button type="button" onClick={restart}>
      {["sent", "received", "declined", "error"].includes(phase.kind) ? t("nearby.again") : t("redact.cancel")}
    </button>
  );

  let body = null;
  let actions = null;
  if (mode === "choose") {
    body = (
      <>
        {!state.files.length ? <p class="hint">{t("nearby.emptyTray")}</p> : null}
        <form
          class="nearby-paste"
          onSubmit={(e) => {
            e.preventDefault();
            const invite = parseInvite(pasted);
            setNotLink(!invite);
            if (!invite) return;
            setMode("receive");
            setPhase({ kind: "invited", invite });
          }}
        >
          <label for="remote-paste">{t("remote.paste")}</label>
          <textarea id="remote-paste" rows={2} value={pasted} onInput={(e) => setPasted(e.currentTarget.value)} spellcheck={false} autocomplete="off" data-testid="remote-paste" />
          {notLink ? <p class="error">{t("remote.notLink")}</p> : null}
          <div class="buttons">
            <button type="submit">{t("nearby.pasteApply")}</button>
          </div>
        </form>
      </>
    );
    actions = (
      <button type="button" class="primary" disabled={!state.files.length} onClick={() => setMode("send")}>
        {t("nearby.send")}
      </button>
    );
  } else if (mode === "send" && phase.kind === "idle") {
    body = (
      <>
        {out.picker}
        {privacy}
      </>
    );
    actions = (
      <>
        <button type="button" class="primary" disabled={!out.files.length} onClick={() => void startSend()}>
          {t("remote.start", { n: out.files.length })}
        </button>
        {cancel}
      </>
    );
  } else if (phase.kind === "sharing") {
    body = (
      <>
        <p>{t("remote.share")}</p>
        {linkBox(phase.link, t("remote.link"), "remote-link")}
        {phase.onion ? (
          <details>
            <summary>{t("remote.onionLink")}</summary>
            {linkBox(phase.onion, t("remote.onionLink"), "remote-onion-link")}
          </details>
        ) : (
          <p class="hint">{t("remote.clearnetNote")}</p>
        )}
      </>
    );
    actions = cancel;
  } else if (phase.kind === "invited") {
    body = privacy;
    actions = (
      <>
        <button type="button" class="primary" onClick={() => void join(phase.invite)}>
          {t("remote.join")}
        </button>
        {cancel}
      </>
    );
  } else if (phase.kind === "review") {
    const total = phase.incoming.files.reduce((sum, f: FileMeta) => sum + f.size, 0);
    body = (
      <div class="nearby-review">
        <p>{t("nearby.incoming", { n: phase.incoming.files.length, total: size(total) })}</p>
        <ul data-testid="remote-incoming">
          {phase.incoming.files.map((f, i) => (
            <li key={i}>
              {f.name} <small class="hint">{size(f.size)}</small>
            </li>
          ))}
        </ul>
        {total > MAX_TOTAL ? <p class="error">{t("nearby.error.tooLarge")}</p> : null}
        <p class="hint">{t("remote.confirmNote")}</p>
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
            done({ kind: "declined" });
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
    <div class="nearby remote">
      {status ? (
        <p class={phase.kind === "error" ? "error" : "hint"} role="status" data-testid="remote-status">
          {status}
        </p>
      ) : null}
      {connNote ? (
        <p class="hint" role="status" data-testid="remote-conn">
          {connNote}
        </p>
      ) : null}
      {confirm && phase.kind !== "error" ? (
        <p data-testid="remote-confirm">
          {t("nearby.confirm")} <strong>{confirm}</strong>
        </p>
      ) : null}
      {body}
      {actions ? <div class="buttons nearby-actions">{actions}</div> : null}
    </div>
  );
}

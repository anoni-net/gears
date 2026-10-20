import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import { routeUrl } from "../router.ts";
import { IS_ONION } from "../site.ts";
import { tray } from "../state.ts";
import { type FileMeta, MAX_TOTAL } from "../tools/nearby/protocol.ts";
import { type Incoming, TooLargeError, receiveFiles, sendFiles } from "../tools/nearby/transfer.ts";
import { type CallEnd, CallDesk, type CallView } from "../tools/remote/call.ts";
import { type Direct, FILES_OVER_DIRECT, Signals, connectDirect } from "../tools/remote/direct.ts";
import { type Invite, inviteHash, onionLink, parseInvite } from "../tools/remote/invite.ts";
import { type Lanes, MAX_MESSAGE, split } from "../tools/remote/mux.ts";
import { type Ice, NO_ICE } from "../tools/remote/relay.ts";
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
  | { kind: "talk" } // 不傳檔案，連上之後只互傳文字訊息與視訊通話
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
  const [mode, setMode] = useState<"choose" | "send" | "talk" | "receive">("choose");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [confirm, setConfirm] = useState("");
  const [conn, setConn] = useState<SessionState | null>(null);
  const [pasted, setPasted] = useState("");
  const [notLink, setNotLink] = useState(false);
  const [copied, setCopied] = useState("");
  // 傳送進行中又打開另一個連結時先留著，問讀者要不要改用
  const [pendingInvite, setPendingInvite] = useState<Invite | null>(null);
  const session = useRef<RemoteSession | null>(null);
  // 傳完之後對方關掉連線是正常的，不當成錯誤
  const finished = useRef(false);
  // 文字訊息：連上之後兩端都能送，傳完檔案之後連線留著，讀者按「結束連線」或換一個連結才關掉。
  // 訊息只在這個元件的記憶體裡，不寫進任何儲存空間
  const lanes = useRef<Lanes | null>(null);
  const [messages, setMessages] = useState<{ mine: boolean; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [ended, setEnded] = useState<"" | "self" | "peer">("");
  // A 版：經過 TURN 的 WebRTC（direct.ts）。檔案要不要改走資料通道見 FILES_OVER_DIRECT
  const signals = useRef<Signals | null>(null);
  const direct = useRef<Direct | null>(null);
  const [via, setVia] = useState<"" | "direct" | "relay">("");
  // 視訊通話（call.ts）：伺服器發了 TURN 之後才知道能不能打
  const desk = useRef<CallDesk | null>(null);
  const [canCall, setCanCall] = useState<boolean | null>(null);
  const [call, setCall] = useState<CallView | null>(null);
  const [callEnd, setCallEnd] = useState<CallEnd | null>(null);

  const busy = phase.kind === "creating" || phase.kind === "connecting" || phase.kind === "awaiting" || phase.kind === "transfer";
  const open = busy || phase.kind === "sharing" || phase.kind === "review";
  const chatting = !!confirm && !ended && phase.kind !== "error";
  useWorking(open || chatting);
  useWakeLock(open || !!call);

  useEffect(() => {
    // 手機切回前景時馬上接回去，不等下一次重試
    const onVisible = () => {
      if (document.visibilityState === "visible") session.current?.reconnectNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      direct.current?.close();
      desk.current?.close();
      session.current?.close();
    };
  }, []);

  // 從分享連結打開時讀 # 後面，讀完就從網址清掉，不留在瀏覽紀錄裡。不自動連線：通訊軟體的預覽
  // 可能在伺服器端打開連結，自動加入的話一次性的房間會先被用掉，讀者按「加入」才連
  // 頁面已經開著、在網址列貼上連結時只有 # 後面變了，瀏覽器不會重新載入，另外聽 hashchange。
  // 上一次傳完或出錯之後也要接得住新的連結，傳送進行中則先問讀者
  const fromHash = useRef<() => void>(() => {});
  fromHash.current = () => {
    const invite = parseInvite(location.hash);
    if (!invite) return;
    history.replaceState(history.state, "", location.pathname + location.search);
    if (open) setPendingInvite(invite);
    else openInvite(invite);
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

  // 連線分成檔案、文字訊息與信令三條（mux.ts），回傳檔案那一條給傳輸的流程用
  const watch = (s: RemoteSession, link: RelayLink) => {
    session.current = s;
    finished.current = false;
    s.onState(setConn);
    void s.confirm.then(setConfirm, () => {});
    const l = split(s);
    lanes.current = l;
    const sig = new Signals(l.signals);
    signals.current = sig;
    void iceOf(link).then((ice) => {
      if (lanes.current !== l) return;
      const d = new CallDesk(sig, ice);
      desk.current = d;
      setCanCall(d.supported);
      d.onChange((view, end) => {
        setCall(view);
        setCallEnd(end ?? null);
      });
    });
    void (async () => {
      try {
        for (;;) {
          const text = await l.messages.next();
          if (typeof text !== "string" || !text.trim() || text.length > MAX_MESSAGE) continue;
          setMessages((m) => [...m, { mine: false, text }]);
        }
      } catch {
        if (lanes.current === l) setEnded((e) => e || "peer");
      }
    })();
    return l.files;
  };

  // 檔案傳完、拒絕之後連線留著，兩端還能互傳文字訊息
  const done = (next: Phase) => {
    finished.current = true;
    setPhase(next);
  };

  const sendMessage = () => {
    const text = draft.trim();
    if (!text || !lanes.current || ended) return;
    try {
      lanes.current.messages.send(text.slice(0, MAX_MESSAGE));
    } catch {
      return;
    }
    setMessages((m) => [...m, { mine: true, text: text.slice(0, MAX_MESSAGE) }]);
    setDraft("");
  };

  const dropDirect = () => {
    direct.current?.close();
    direct.current = null;
  };

  // 伺服器配對之後發的 TURN 設定。onion 版不用：TURN 走 UDP、不經過 Tor
  const iceOf = (link: RelayLink): Promise<Ice> =>
    IS_ONION ? Promise.resolve(NO_ICE) : Promise.race([link.ice, new Promise<Ice>((r) => setTimeout(() => r(NO_ICE), 5000))]);

  const closeCall = () => {
    desk.current?.close();
    desk.current = null;
    setCall(null);
    setCallEnd(null);
    setCanCall(null);
  };

  const hangUp = () => {
    closeCall();
    dropDirect();
    lanes.current = null;
    session.current?.close();
    session.current = null;
    setConn(null);
    setEnded("self");
  };

  // ── 送出端 ──
  // withFiles 是 false 時不傳檔案，連上之後只互傳文字訊息與視訊通話
  const startSend = async (withFiles = true) => {
    setPhase({ kind: "creating" });
    try {
      const link = await RelayLink.open(relayUrl());
      const invite = { room: link.room, key: newLinkKey() };
      const s = new RemoteSession(link, invite.key, "opener");
      const files = watch(s, link);
      const route = routeUrl("remote");
      setPhase({
        kind: "sharing",
        link: new URL(`${route}#${inviteHash(invite)}`, location.href).href,
        onion: IS_ONION ? "" : onionLink(route.slice(import.meta.env.BASE_URL.length), invite),
      });
      await link.paired;
      setPhase({ kind: "connecting" });
      await s.confirm;
      if (!withFiles) {
        // 接收端在檔案改走資料通道時會先等 offer，告訴它不必等
        if (FILES_OVER_DIRECT) signals.current!.send({ t: "no" });
        signals.current!.send({ t: "via", rtc: false, files: false });
        return done({ kind: "talk" });
      }
      // 送出端決定檔案走哪一條，用 via 告訴接收端。檔案預設走轉送服務，不建立資料通道，
      // 雙方的 IP 只在開始視訊時才交給 TURN
      const d = FILES_OVER_DIRECT ? await connectDirect(signals.current!, await iceOf(link), "opener") : null;
      direct.current = d;
      signals.current!.send({ t: "via", rtc: !!d });
      setVia(d ? "direct" : "relay");
      setPhase({ kind: "awaiting" });
      const progress = (sent: number, total: number) => setPhase({ kind: "transfer", done: sent, total });
      let result;
      try {
        result = await sendFiles(d?.channel ?? files, out.outgoing(), progress);
      } catch (error) {
        // 資料通道傳到一半斷掉時改用轉送服務重傳，接收端不必再按一次接收
        if (!d || !lanes.current) throw error;
        dropDirect();
        setVia("relay");
        signals.current!.send({ t: "via", rtc: false, retry: true });
        result = await sendFiles(files, out.outgoing(), progress);
      }
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
      const files = watch(s, link);
      await s.confirm;
      const d = FILES_OVER_DIRECT ? await connectDirect(signals.current!, await iceOf(link), "joiner") : null;
      const v = await signals.current!.next((m) => m.t === "via", 30_000);
      if (v?.t !== "via" || (v.rtc && !d)) throw new Error("failed");
      if (v.files === false) {
        d?.close();
        return done({ kind: "talk" });
      }
      if (v.rtc) direct.current = d;
      else d?.close();
      setVia(v.rtc ? "direct" : "relay");
      const incoming = await receiveFiles(v.rtc ? d!.channel : files);
      setPhase({ kind: "review", incoming });
    } catch (error) {
      fail(error);
    }
  };
  const accept = async (incoming: Incoming) => {
    setPhase({ kind: "transfer", done: 0, total: incoming.files.reduce((s, f) => s + f.size, 0) });
    try {
      const progress = (received: number, total: number) => setPhase({ kind: "transfer", done: received, total });
      let result;
      try {
        result = await incoming.accept(progress);
      } catch (error) {
        // 資料通道傳到一半斷掉：等送出端改用轉送服務重傳，清單相同就直接接收
        if (error instanceof TooLargeError || !direct.current || !lanes.current) throw error;
        dropDirect();
        const retry = await signals.current?.next((m) => m.t === "via" && m.retry === true, 20_000);
        if (!retry) throw error;
        setVia("relay");
        const again = await receiveFiles(lanes.current.files);
        if (JSON.stringify(again.files) !== JSON.stringify(incoming.files)) throw new Error("failed");
        result = await again.accept(progress);
      }
      if (result.files.length) await tray.add(result.files, "remote");
      track("tool-done", { tool: "remote" });
      done({ kind: "received", count: result.files.length, failed: result.ok.filter((ok) => !ok).length });
    } catch (error) {
      fail(error);
    }
  };

  const reset = () => {
    closeCall();
    dropDirect();
    signals.current = null;
    setVia("");
    lanes.current = null;
    session.current?.close();
    session.current = null;
    setMessages([]);
    setDraft("");
    setEnded("");
    finished.current = false;
    setConn(null);
    setConfirm("");
    setPasted("");
    setNotLink(false);
    setCopied("");
    setPendingInvite(null);
  };
  const restart = () => {
    reset();
    setPhase({ kind: "idle" });
    setMode("choose");
  };
  function openInvite(invite: Invite) {
    reset();
    setMode("receive");
    setPhase({ kind: "invited", invite });
  }

  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => setCopied(text),
      () => {},
    );

  // 視訊通話。onion 版、瀏覽器不支援或伺服器沒有發 TURN 時只說明不能打
  const callButtons = (...items: [string, () => void, string?][]) => (
    <div class="buttons">
      {items.map(([label, run, testid]) => (
        <button type="button" key={label} onClick={run} data-testid={testid}>
          {label}
        </button>
      ))}
    </div>
  );
  const callBody = () => {
    const d = desk.current;
    if (canCall === null || !d) return null;
    if (!canCall) return <p class="hint">{t(IS_ONION ? "remote.call.onion" : "remote.call.unsupported")}</p>;
    if (!call)
      return (
        <>
          <p class="hint">{t("remote.call.note")}</p>
          {callEnd ? (
            <p role="status" data-testid="remote-call-ended">
              {t(`remote.call.end.${callEnd}`)}
            </p>
          ) : null}
          {callButtons([t("remote.call.start"), () => void d.start(), "remote-call-start"])}
        </>
      );
    if (call.state === "incoming")
      return (
        <>
          <p role="status" data-testid="remote-call-status">
            {t("remote.call.incoming")}
          </p>
          <p class="hint">{t("remote.call.note")}</p>
          {callButtons([t("remote.call.accept"), () => void d.accept(), "remote-call-accept"], [t("remote.call.decline"), () => d.decline(), "remote-call-decline"])}
        </>
      );
    return (
      <>
        <p role="status" data-testid="remote-call-status" data-state={call.state}>
          {t(`remote.call.${call.state}`)}
        </p>
        <div class="remote-videos">
          {call.remote ? <CallVideo stream={call.remote} label={t("remote.call.remote")} testid="remote-video-peer" /> : null}
          {call.local ? <CallVideo stream={call.local} label={t("remote.call.local")} testid="remote-video-self" muted /> : null}
        </div>
        {call.state === "live"
          ? callButtons(
              [t(call.mic ? "remote.call.micOff" : "remote.call.micOn"), () => d.toggle("audio"), "remote-call-mic"],
              [t(call.cam ? "remote.call.camOff" : "remote.call.camOn"), () => d.toggle("video"), "remote-call-cam"],
              [t("remote.call.hangUp"), () => d.hangUp(), "remote-call-hangup"],
            )
          : callButtons([t(call.state === "ringing" ? "remote.call.cancel" : "remote.call.hangUp"), () => d.hangUp(), "remote-call-hangup"])}
      </>
    );
  };
  const callSection =
    canCall === null ? null : (
      <section class="remote-call" aria-labelledby="remote-call-title" data-testid="remote-call">
        <h3 id="remote-call-title">{t("remote.call.title")}</h3>
        {callBody()}
      </section>
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
          {IS_ONION || !FILES_OVER_DIRECT ? null : <li>{t("remote.privacy.direct")}</li>}
          {IS_ONION ? null : <li>{t("remote.privacy.call")}</li>}
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
      case "talk":
        return ended ? "" : t("remote.talking");
      case "error":
        return t(`remote.error.${phase.reason}`);
      default:
        return "";
    }
  })();

  // 連上之後的連線狀態：自己斷線正在接回去，或對方暫時離線
  const live = (open || chatting) && phase.kind !== "creating";
  const connNote = live && conn === "reconnecting" ? t("remote.reconnecting") : live && conn === "peer-away" ? t("remote.peerAway") : "";

  const cancel = (
    <button type="button" onClick={restart}>
      {["sent", "received", "declined", "talk", "error"].includes(phase.kind) ? t("nearby.again") : t("redact.cancel")}
    </button>
  );

  let body = null;
  let actions = null;
  if (mode === "choose") {
    body = (
      <>
        {!state.files.length ? <p class="hint">{t("remote.emptyTray")}</p> : null}
        <form
          class="nearby-paste"
          onSubmit={(e) => {
            e.preventDefault();
            const invite = parseInvite(pasted);
            setNotLink(!invite);
            if (invite) openInvite(invite);
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
      <>
        <button type="button" class="primary" disabled={!state.files.length} onClick={() => setMode("send")}>
          {t("nearby.send")}
        </button>
        <button type="button" class={state.files.length ? "" : "primary"} onClick={() => setMode("talk")}>
          {t("remote.talk")}
        </button>
      </>
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
  } else if (mode === "talk" && phase.kind === "idle") {
    body = (
      <>
        <p>{t("remote.talkNote")}</p>
        {privacy}
      </>
    );
    actions = (
      <>
        <button type="button" class="primary" onClick={() => void startSend(false)}>
          {t("remote.startTalk")}
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
  } else if (phase.kind === "talk") {
    // 連線中用文字訊息底下的「結束連線」，結束之後才能重新開始
    actions = ended ? cancel : null;
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
      {pendingInvite ? (
        <div class="remote-pending" role="status" data-testid="remote-pending">
          <p>{t("remote.pendingInvite")}</p>
          <div class="buttons">
            <button type="button" onClick={() => openInvite(pendingInvite)}>
              {t("remote.switchInvite")}
            </button>
            <button type="button" onClick={() => setPendingInvite(null)}>
              {t("remote.keepCurrent")}
            </button>
          </div>
        </div>
      ) : null}
      {connNote ? (
        <p class="hint" role="status" data-testid="remote-conn">
          {connNote}
        </p>
      ) : null}
      {via && ["awaiting", "review", "transfer", "sent", "received"].includes(phase.kind) ? (
        <p class="hint" data-testid="remote-via" data-via={via}>
          {t(via === "direct" ? "remote.via.direct" : "remote.via.relay")}
        </p>
      ) : null}
      {confirm && phase.kind !== "error" ? (
        <p data-testid="remote-confirm">
          {t("nearby.confirm")} <strong>{confirm}</strong>
        </p>
      ) : null}
      {body}
      {actions ? <div class="buttons nearby-actions">{actions}</div> : null}
      {confirm && phase.kind !== "error" && !ended ? callSection : null}
      {confirm && phase.kind !== "error" ? (
        <section class="remote-chat" aria-labelledby="remote-chat-title">
          <h3 id="remote-chat-title">{t("remote.chat.title")}</h3>
          <p class="hint">{t("remote.chat.note")}</p>
          {messages.length ? (
            <ol class="remote-messages" aria-live="polite" data-testid="remote-messages">
              {messages.map((m, i) => (
                <li key={i} class={m.mine ? "mine" : "theirs"}>
                  <span class="who">{m.mine ? t("remote.chat.me") : t("remote.chat.them")}</span>
                  <span class="text">{m.text}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {ended ? (
            <p class="hint" role="status" data-testid="remote-ended">
              {t(ended === "self" ? "remote.chat.endedSelf" : "remote.chat.endedPeer")}
            </p>
          ) : (
            <form
              class="remote-compose"
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
            >
              <label for="remote-chat-input">{t("remote.chat.label")}</label>
              <textarea
                id="remote-chat-input"
                rows={2}
                maxLength={MAX_MESSAGE}
                value={draft}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                data-testid="remote-chat-input"
              />
              <div class="buttons">
                <button type="submit" disabled={!draft.trim()}>
                  {t("remote.chat.send")}
                </button>
                {finished.current || phase.kind === "sent" || phase.kind === "received" || phase.kind === "declined" ? (
                  <button type="button" onClick={hangUp}>
                    {t("remote.chat.end")}
                  </button>
                ) : null}
              </div>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}

// 通話的畫面。同一個 MediaStream 之後加進來的軌道會自動播放，不必重設
function CallVideo({ stream, label, testid, muted = false }: { stream: MediaStream; label: string; testid: string; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || video.srcObject === stream) return;
    video.srcObject = stream;
    // autoplay 不一定會動（Chromium 在畫面還沒有軌道時設定的就不會），另外叫一次
    void video.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} class={muted ? "self" : "peer"} autoPlay playsInline muted={muted} aria-label={label} data-testid={testid} />;
}

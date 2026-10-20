// 遠端傳送的 A 版：經過 TURN 的 WebRTC 資料通道（anoni-net/gears#104）。
//
// 建立資料通道用的 SDP 與候選走轉送服務上已經加密的信令那一條（mux.ts 的 s）。DTLS 的指紋經過
// 兩端之間的加密送達，轉送服務與 Cloudflare 都換不掉，資料通道本身就是兩端之間加密的。
//
// - policy 是 relay：只經過 TURN，兩端看不到彼此的 IP，Cloudflare 看得到兩端的 IP、時間與資料量
// - 10 秒內打不開、瀏覽器沒有 WebRTC（Tor Browser）、伺服器沒有發 TURN（off）：回傳 null，照舊用轉送服務。
//   onion 版由呼叫的人直接傳 NO_ICE：TURN 走 UDP、不經過 Tor，會讓 Cloudflare 看到讀者的 IP
// - 送出端決定檔案走哪一條，用 via 告訴接收端。資料通道傳到一半斷掉時，送出端改用轉送服務重傳（retry）
// - 文字訊息一律留在轉送服務上，資料通道只傳檔案

import type { Channel } from "../nearby/channel.ts";
import { rtcChannel } from "../nearby/rtc-channel.ts";
import { type Ice, isId } from "./relay.ts";

export const DIRECT_TIMEOUT = 10_000;

// 檔案要不要改走資料通道。2026-10-21 在正式站量（Chromium，每種條件 3 次的中位數）：經過
// Cloudflare 的 TURN 每秒約 2.8 MB（走 TCP、TLS 只有 0.4 到 0.5 MB），經過轉送服務約 6.9 MB，
// 調整訊息大小、緩衝門檻與多條連線並行都沒有穩定的改善。所以檔案預設走轉送服務，資料通道
// 留給視訊。自架的 TURN 上線、量過比較快之後再打開
export const FILES_OVER_DIRECT = false;

export type Signal =
  | { t: "offer" | "answer"; sdp: string }
  | { t: "cand"; c: RTCIceCandidateInit | null }
  | { t: "no" }
  // files 是 false：這次不傳檔案，只互傳文字訊息與視訊通話
  | { t: "via"; rtc: boolean; retry?: boolean; files?: false }
  // 視訊通話（call.ts）：n 是這一通的編號，SDP 與候選跟資料通道的分開
  | { t: "ring" | "pick" | "bye"; n: string; why?: "unsupported" }
  | { t: "coffer" | "canswer"; n: string; sdp: string }
  | { t: "ccand"; n: string; c: RTCIceCandidateInit | null };

// 對方送來的信令先檢查格式，不合的丟掉
export function parseSignal(text: string): Signal | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  const sdp = (v: unknown) => (typeof v === "string" && v.length < 20_000 ? v : null);
  const n = typeof m.n === "string" && isId(m.n) ? m.n : null;
  switch (m.t) {
    case "offer":
    case "answer":
      return sdp(m.sdp) ? { t: m.t, sdp: m.sdp as string } : null;
    case "cand": {
      const c = candidate(m.c);
      return c === undefined ? null : { t: "cand", c };
    }
    case "ring":
    case "pick":
      return n ? { t: m.t, n } : null;
    case "bye":
      return n ? (m.why === "unsupported" ? { t: "bye", n, why: "unsupported" } : { t: "bye", n }) : null;
    case "coffer":
    case "canswer":
      return n && sdp(m.sdp) ? { t: m.t, n, sdp: m.sdp as string } : null;
    case "ccand": {
      const c = candidate(m.c);
      return n && c !== undefined ? { t: "ccand", n, c } : null;
    }
    case "no":
      return { t: "no" };
    case "via":
      if (typeof m.rtc !== "boolean") return null;
      return m.files === false ? { t: "via", rtc: m.rtc, retry: m.retry === true, files: false } : { t: "via", rtc: m.rtc, retry: m.retry === true };
    default:
      return null;
  }
}

// 候選：null 代表蒐集完了，格式不對是 undefined
function candidate(v: unknown): RTCIceCandidateInit | null | undefined {
  if (v === null) return null;
  const c = v as Record<string, unknown>;
  if (!c || typeof c !== "object" || typeof c.candidate !== "string" || c.candidate.length > 1000) return undefined;
  return {
    candidate: c.candidate,
    sdpMid: typeof c.sdpMid === "string" ? c.sdpMid : null,
    sdpMLineIndex: typeof c.sdpMLineIndex === "number" ? c.sdpMLineIndex : null,
  };
}

interface Waiter {
  match: (s: Signal) => boolean;
  resolve: (s: Signal | null) => void;
}

// 信令那一條的收發。候選另外交給 onCandidate，listen() 的人先挑，其他的依序交給 next() 等著的人，
// 沒人等的先排著
export class Signals {
  private queue: Signal[] = [];
  private waiters: Waiter[] = [];
  private listeners: ((s: Signal | null) => boolean)[] = [];
  private candidates: (RTCIceCandidateInit | null)[] = [];
  private onCand: ((c: RTCIceCandidateInit | null) => void) | null = null;
  private ended = false;

  constructor(private readonly channel: Channel) {
    void (async () => {
      try {
        for (;;) {
          const item = await channel.next();
          const s = typeof item === "string" ? parseSignal(item) : null;
          if (s) this.deliver(s);
        }
      } catch {
        this.ended = true;
        for (const w of this.waiters.splice(0)) w.resolve(null);
        for (const fn of this.listeners.splice(0)) fn(null);
      }
    })();
  }

  send(s: Signal) {
    try {
      this.channel.send(JSON.stringify(s));
    } catch {
      // 轉送服務斷線時送不出去，等對方逾時
    }
  }

  onCandidate(fn: (c: RTCIceCandidateInit | null) => void) {
    this.onCand = fn;
    for (const c of this.candidates.splice(0)) fn(c);
  }

  // 一直收下去，fn 回傳 true 的就是它收走了。連線結束時收到 null。已經排著的先交給它
  listen(fn: (s: Signal | null) => boolean): () => void {
    if (this.ended) {
      fn(null);
      return () => {};
    }
    this.listeners.push(fn);
    this.queue = this.queue.filter((s) => !fn(s));
    return () => {
      const at = this.listeners.indexOf(fn);
      if (at >= 0) this.listeners.splice(at, 1);
    };
  }

  // 等下一則符合的信令，逾時或連線結束時是 null
  next(match: (s: Signal) => boolean, timeout: number): Promise<Signal | null> {
    const i = this.queue.findIndex(match);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]!);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => {
      const w: Waiter = { match, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const at = this.waiters.indexOf(w);
        if (at < 0) return;
        this.waiters.splice(at, 1);
        resolve(null);
      }, timeout);
    });
  }

  private deliver(s: Signal) {
    if (s.t === "cand") {
      if (this.onCand) this.onCand(s.c);
      else this.candidates.push(s.c);
      return;
    }
    if (this.listeners.some((fn) => fn(s))) return;
    const at = this.waiters.findIndex((w) => w.match(s));
    if (at >= 0) this.waiters.splice(at, 1)[0]!.resolve(s);
    else this.queue.push(s);
  }
}

export interface Direct {
  channel: Channel;
  close(): void;
}

// 開房的一端發起，加入的一端回應。打不開時回傳 null，對方也會在逾時或收到 no 之後回傳 null
export async function connectDirect(signals: Signals, ice: Ice, role: "opener" | "joiner", timeout = DIRECT_TIMEOUT): Promise<Direct | null> {
  if (ice.policy === "off" || typeof RTCPeerConnection !== "function") {
    signals.send({ t: "no" });
    return null;
  }
  const deadline = Date.now() + timeout;
  const left = () => Math.max(0, deadline - Date.now());
  const pc = new RTCPeerConnection({ iceServers: ice.servers, iceTransportPolicy: ice.policy === "relay" ? "relay" : "all" });
  let remoteSet = false;
  const pending: RTCIceCandidateInit[] = [];
  signals.onCandidate((c) => {
    if (!c) return;
    if (remoteSet) void pc.addIceCandidate(c).catch(() => {});
    else pending.push(c);
  });
  pc.addEventListener("icecandidate", (e) => signals.send({ t: "cand", c: e.candidate ? e.candidate.toJSON() : null }));
  const setRemote = async (d: RTCSessionDescriptionInit) => {
    await pc.setRemoteDescription(d);
    remoteSet = true;
    for (const c of pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  };
  try {
    let wrapped: Promise<{ dc: RTCDataChannel; channel: Channel }>;
    if (role === "opener") {
      const dc = pc.createDataChannel("gears-remote", { ordered: true });
      wrapped = Promise.resolve({ dc, channel: rtcChannel(dc) });
      await pc.setLocalDescription();
      signals.send({ t: "offer", sdp: pc.localDescription!.sdp });
      const reply = await signals.next((s) => s.t === "answer" || s.t === "no", left());
      if (reply?.t !== "answer") throw new Error("no-direct");
      await setRemote({ type: "answer", sdp: reply.sdp });
    } else {
      // 在拿到資料通道的當下就包，對方一打開就送的訊息才不會漏掉
      wrapped = new Promise((resolve) => pc.addEventListener("datachannel", (e) => resolve({ dc: e.channel, channel: rtcChannel(e.channel) })));
      const offer = await signals.next((s) => s.t === "offer" || s.t === "no", left());
      if (offer?.t !== "offer") throw new Error("no-direct");
      await setRemote({ type: "offer", sdp: offer.sdp });
      await pc.setLocalDescription();
      signals.send({ t: "answer", sdp: pc.localDescription!.sdp });
    }
    const { dc, channel } = await within(wrapped, left());
    if (dc.readyState !== "open") {
      await within(
        new Promise<void>((resolve, reject) => {
          dc.addEventListener("open", () => resolve());
          dc.addEventListener("close", () => reject(new Error("closed")));
        }),
        left(),
      );
    }
    return { channel, close: () => pc.close() };
  } catch {
    pc.close();
    return null;
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

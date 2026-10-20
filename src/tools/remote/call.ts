// 遠端傳送的視訊通話（anoni-net/gears#104）。
//
// 每一通另外建一個只有影音的 RTCPeerConnection，不跟檔案共用，也不必重新協商。邀請、接聽、掛斷、
// SDP 與候選都走轉送服務上已經加密的信令那一條（direct.ts 的 Signals）。DTLS 的指紋經過兩端之間的
// 加密送達，畫面與聲音的 SRTP 金鑰由兩端協商，轉送服務與 Cloudflare 都看不到內容。
//
// - policy 是 relay：只經過 TURN，兩端看不到彼此的 IP，Cloudflare 看得到兩端的 IP、時間與資料量
// - onion 版、沒有 WebRTC 或相機 API 的瀏覽器、伺服器沒有發 TURN 時不能打，收到邀請時回 bye 加上
//   unsupported，對方的畫面上才說得清楚
// - 一次只有一通。兩端同時按下時，編號大的那一通算數，另一端改當接聽的人
// - 發起的一端在對方接聽之後送 offer，雙方在接聽之前就先取得相機與麥克風，權限被拒時不送出邀請

import type { Ice } from "./relay.ts";
import { randomId } from "./relay.ts";
import type { Signal, Signals } from "./direct.ts";

export const RING_TIMEOUT = 45_000;
export const CONNECT_TIMEOUT = 20_000;

export type CallEnd = "self" | "peer" | "declined" | "cancelled" | "noAnswer" | "unsupported" | "media" | "failed";

export interface CallView {
  mine: boolean;
  state: "ringing" | "incoming" | "connecting" | "live";
  local: MediaStream | null;
  remote: MediaStream | null;
  mic: boolean;
  cam: boolean;
}

type GetMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

// 先要相機加麥克風，找不到相機時只用麥克風
const VIDEO: MediaStreamConstraints = { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } };

export function callSupported(ice: Ice): boolean {
  return (
    ice.policy !== "off" &&
    typeof RTCPeerConnection === "function" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    globalThis.isSecureContext !== false
  );
}

interface Active {
  n: string;
  mine: boolean;
  state: CallView["state"];
  local: MediaStream | null;
  remote: MediaStream | null;
  pc: RTCPeerConnection | null;
  remoteSet: boolean;
  pending: RTCIceCandidateInit[];
  timer: ReturnType<typeof setTimeout> | null;
}

// 一個連線上的通話。onChange 收到目前的狀態，結束時 view 是 null、附上原因
export class CallDesk {
  private call: Active | null = null;
  private listeners = new Set<(view: CallView | null, ended?: CallEnd) => void>();
  private readonly stop: () => void;
  readonly supported: boolean;

  constructor(
    private readonly signals: Signals,
    private readonly ice: Ice,
    private readonly getMedia: GetMedia = (c) => navigator.mediaDevices.getUserMedia(c),
  ) {
    this.supported = callSupported(ice);
    this.stop = signals.listen((s) => this.receive(s));
  }

  onChange(fn: (view: CallView | null, ended?: CallEnd) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  view(): CallView | null {
    const c = this.call;
    if (!c) return null;
    const enabled = (kind: "audio" | "video") => !!c.local?.getTracks().some((t) => t.kind === kind && t.enabled);
    return { mine: c.mine, state: c.state, local: c.local, remote: c.remote, mic: enabled("audio"), cam: enabled("video") };
  }

  // 發起通話。取得相機與麥克風之後才送出邀請
  async start(): Promise<void> {
    if (this.call || !this.supported) return;
    const c: Active = { n: randomId(), mine: true, state: "ringing", local: null, remote: null, pc: null, remoteSet: false, pending: [], timer: null };
    this.call = c;
    this.emit();
    const local = await this.media();
    if (this.call !== c) return local?.getTracks().forEach((t) => t.stop());
    if (!local) return this.end("media", !c.mine);
    c.local = local;
    if (c.mine) {
      this.signals.send({ t: "ring", n: c.n });
      this.arm(RING_TIMEOUT, "noAnswer");
      this.emit();
    } else this.pick(c);
  }

  async accept(): Promise<void> {
    const c = this.call;
    if (!c || c.state !== "incoming") return;
    c.state = "connecting";
    this.emit();
    const local = await this.media();
    if (this.call !== c) return local?.getTracks().forEach((t) => t.stop());
    if (!local) return this.end("media", true);
    c.local = local;
    this.pick(c);
  }

  decline() {
    if (this.call?.state === "incoming") this.end("self", true);
  }

  hangUp() {
    if (this.call) this.end("self", true);
  }

  // 關掉麥克風或鏡頭：軌道留著、送出靜音與黑畫面，不必重新協商
  toggle(kind: "audio" | "video") {
    const tracks = this.call?.local?.getTracks().filter((t) => t.kind === kind) ?? [];
    const on = !tracks.some((t) => t.enabled);
    for (const t of tracks) t.enabled = on;
    this.emit();
  }

  // 整個連線結束時呼叫
  close() {
    if (this.call) this.end("self", true);
    this.stop();
    this.listeners.clear();
  }

  private receive(s: Signal | null): boolean {
    if (!s) {
      if (this.call) this.end("peer", false);
      return false;
    }
    if (!("n" in s)) return false;
    const c = this.call;
    switch (s.t) {
      case "ring":
        if (!this.supported) {
          this.signals.send({ t: "bye", n: s.n, why: "unsupported" });
        } else if (!c) {
          this.call = { n: s.n, mine: false, state: "incoming", local: null, remote: null, pc: null, remoteSet: false, pending: [], timer: null };
          this.arm(RING_TIMEOUT + 5_000, "cancelled", false);
          this.emit();
        } else if (c.mine && c.state === "ringing" && s.n > c.n) {
          // 兩端同時打：改接對方那一通，自己的那一通對方會丟掉。還在等相機的話，拿到之後再接
          c.n = s.n;
          c.mine = false;
          if (c.local) this.pick(c);
        }
        return true;
      case "pick":
        if (c?.n === s.n && c.mine && c.state === "ringing") void this.offer(c);
        return true;
      case "bye":
        if (c?.n === s.n) this.end(s.why === "unsupported" ? "unsupported" : c.state === "ringing" ? "declined" : c.state === "incoming" ? "cancelled" : "peer", false);
        return true;
      case "coffer":
        if (c?.n === s.n && !c.mine && c.pc) void this.answer(c, s.sdp);
        return true;
      case "canswer":
        if (c?.n === s.n && c.mine && c.pc) void this.setRemote(c, { type: "answer", sdp: s.sdp }).catch(() => this.end("failed", true));
        return true;
      case "ccand":
        if (c?.n === s.n && c.pc && s.c) {
          if (c.remoteSet) void c.pc.addIceCandidate(s.c).catch(() => {});
          else c.pending.push(s.c);
        }
        return true;
      default:
        return false;
    }
  }

  private async media(): Promise<MediaStream | null> {
    try {
      return await this.getMedia(VIDEO);
    } catch (error) {
      if ((error as Error).name !== "NotFoundError" && (error as Error).name !== "OverconstrainedError") return null;
    }
    try {
      return await this.getMedia({ audio: true });
    } catch {
      return null;
    }
  }

  // 接聽：先建好連線等 offer，送出 pick 之後對方才送
  private pick(c: Active) {
    c.state = "connecting";
    this.peer(c);
    this.signals.send({ t: "pick", n: c.n });
    this.arm(CONNECT_TIMEOUT, "failed");
    this.emit();
  }

  private peer(c: Active) {
    const pc = new RTCPeerConnection({ iceServers: this.ice.servers, iceTransportPolicy: this.ice.policy === "relay" ? "relay" : "all" });
    c.pc = pc;
    for (const track of c.local!.getTracks()) pc.addTrack(track, c.local!);
    pc.addEventListener("icecandidate", (e) => {
      if (this.call === c) this.signals.send({ t: "ccand", n: c.n, c: e.candidate ? e.candidate.toJSON() : null });
    });
    pc.addEventListener("track", (e) => {
      if (this.call !== c) return;
      c.remote ??= new MediaStream();
      if (!c.remote.getTracks().includes(e.track)) c.remote.addTrack(e.track);
      this.emit();
    });
    pc.addEventListener("connectionstatechange", () => {
      if (this.call !== c) return;
      if (pc.connectionState === "connected" && c.state !== "live") {
        c.state = "live";
        this.disarm();
        this.emit();
      } else if (pc.connectionState === "failed") this.end("failed", true);
    });
  }

  private async offer(c: Active) {
    c.state = "connecting";
    this.peer(c);
    this.arm(CONNECT_TIMEOUT, "failed");
    this.emit();
    try {
      await c.pc!.setLocalDescription();
      if (this.call === c) this.signals.send({ t: "coffer", n: c.n, sdp: c.pc!.localDescription!.sdp });
    } catch {
      this.end("failed", true);
    }
  }

  private async answer(c: Active, sdp: string) {
    try {
      await this.setRemote(c, { type: "offer", sdp });
      await c.pc!.setLocalDescription();
      if (this.call === c) this.signals.send({ t: "canswer", n: c.n, sdp: c.pc!.localDescription!.sdp });
    } catch {
      this.end("failed", true);
    }
  }

  private async setRemote(c: Active, d: RTCSessionDescriptionInit) {
    await c.pc!.setRemoteDescription(d);
    c.remoteSet = true;
    for (const cand of c.pending.splice(0)) await c.pc!.addIceCandidate(cand).catch(() => {});
  }

  private arm(ms: number, reason: CallEnd, notify = true) {
    this.disarm();
    const c = this.call!;
    c.timer = setTimeout(() => {
      if (this.call === c) this.end(reason, notify);
    }, ms);
  }

  private disarm() {
    if (this.call?.timer) clearTimeout(this.call.timer);
    if (this.call) this.call.timer = null;
  }

  private end(reason: CallEnd, notify: boolean) {
    const c = this.call;
    if (!c) return;
    this.disarm();
    this.call = null;
    if (notify) this.signals.send({ t: "bye", n: c.n });
    c.local?.getTracks().forEach((t) => t.stop());
    c.pc?.close();
    for (const fn of this.listeners) fn(null, reason);
  }

  private emit() {
    const view = this.view();
    for (const fn of this.listeners) fn(view);
  }
}

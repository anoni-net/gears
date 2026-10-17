// 面對面傳送：兩台裝置在同一個網路裡用 WebRTC 直接連線，不經過任何伺服器。
//
// 連線描述的編碼在 src/tools/nearby/codec.ts，訊息格式在 protocol.ts。這裡負責：
// - 送出端建立發起描述，接收端回應，送出端套上回應，等資料通道打開
// - 不設 STUN 與 TURN（iceServers 是空的），候選只有區網裡的位址，連線不會走到網際網路
// - 傳輸：64 KB 一塊，bufferedAmount 超過門檻就等，接收端邊收邊算 SHA-256
//
// Tor Browser 把 WebRTC 整個關掉（RTCPeerConnection 不存在），呼叫的人先用 rtcAvailable() 檢查。

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { CodecError, type Description, buildSdp, decode, encode, fromText, offerTag, parseSdp, toText } from "../tools/nearby/codec.ts";
import { CHUNK, type FileMeta, MAX_TOTAL, type Message, confirmCode, parseMessage, totalSize } from "../tools/nearby/protocol.ts";
import { sha256Blob } from "../tools/verify/hash.ts";

export const rtcAvailable = () => typeof RTCPeerConnection === "function";

// 套上回應之後多久還沒打開就判定連不上。文件站實測連得上的話 1 秒內就通，
// 公共 Wi-Fi 的裝置隔離則會一直等下去（anoni-net/docs#553）
export const CONNECT_TIMEOUT = 15_000;
// 蒐集候選最多等這麼久。區網的 host 候選通常幾十毫秒就到齊
const GATHER_TIMEOUT = 3_000;
// 送出端的緩衝超過這個量就停下來等
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

export class ConnectTimeoutError extends Error {
  constructor() {
    super("connect-timeout");
  }
}

const sessionId = () => String(Math.floor(Math.random() * 2 ** 52));

function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timer = setTimeout(done, GATHER_TIMEOUT);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

// 資料通道與它的訊息佇列。佇列在拿到通道的當下就掛上，對方早一步送來的訊息不會漏掉
export interface Link {
  channel: RTCDataChannel;
  box: ReturnType<typeof inbox>;
}

const link = (channel: RTCDataChannel): Link => {
  channel.binaryType = "arraybuffer";
  return { channel, box: inbox(channel) };
};

export interface Pending {
  pc: RTCPeerConnection;
  code: string; // 放進 QR code 或讓讀者複製的文字
  local: Description;
  remote?: Description;
  link: Promise<Link>;
}

// 送出端：建立發起描述
export async function createOffer(): Promise<Pending> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const ready = link(pc.createDataChannel("gears", { ordered: true }));
  await pc.setLocalDescription();
  await gathered(pc);
  const local = parseSdp(pc.localDescription!.sdp, false);
  return { pc, code: toText(encode(local)), local, link: Promise.resolve(ready) };
}

// 接收端：讀送出端的描述，產生回應
export async function answerOffer(text: string): Promise<Pending> {
  const remote = decode(fromText(text));
  if (remote.answer) throw new CodecError("這是回應，不是發起");
  const pc = new RTCPeerConnection({ iceServers: [] });
  const ready = new Promise<Link>((resolve) => pc.addEventListener("datachannel", (e) => resolve(link(e.channel))));
  await pc.setRemoteDescription({ type: "offer", sdp: buildSdp(remote, sessionId()) });
  await pc.setLocalDescription();
  await gathered(pc);
  const local = { ...parseSdp(pc.localDescription!.sdp, true), tag: offerTag(remote.ufrag) };
  return { pc, code: toText(encode(local)), local, remote, link: ready };
}

// 送出端：套上接收端的回應。對應的是另一次配對（例如送出端重新開始過）時不套
export async function applyAnswer(p: Pending, text: string): Promise<void> {
  const remote = decode(fromText(text));
  if (!remote.answer) throw new CodecError("這是發起，不是回應");
  if (remote.tag !== offerTag(p.local.ufrag)) throw new CodecError("這張回應對應的是另一次配對");
  p.remote = remote;
  await p.pc.setRemoteDescription({ type: "answer", sdp: buildSdp(remote, sessionId()) });
}

// 等資料通道打開，超過 CONNECT_TIMEOUT 就判定連不上
export async function opened(p: Pending): Promise<Link> {
  const deadline = Date.now() + CONNECT_TIMEOUT;
  const ready = await Promise.race([p.link, new Promise<never>((_, reject) => setTimeout(() => reject(new ConnectTimeoutError()), CONNECT_TIMEOUT))]);
  if (ready.channel.readyState === "open") return ready;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ConnectTimeoutError()), Math.max(0, deadline - Date.now()));
    ready.channel.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ready);
    });
    ready.channel.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new ConnectTimeoutError());
    });
  });
}

export const confirmOf = (p: Pending) => (p.remote ? confirmCode(p.local.fingerprint, p.remote.fingerprint) : "");

export function close(p: Pending | null) {
  p?.pc.close();
}

// ── 傳輸 ────────────────────────────────────────────────────────────────────

// 依序取出通道上的訊息。文字是 JSON，二進位是檔案的內容
function inbox(channel: RTCDataChannel) {
  const queue: (string | ArrayBuffer)[] = [];
  const waiting: ((v: string | ArrayBuffer) => void)[] = [];
  let closed: Error | null = null;
  const fail: ((e: Error) => void)[] = [];
  channel.addEventListener("message", (e) => {
    const w = waiting.shift();
    if (w) w(e.data);
    else queue.push(e.data);
  });
  const onClose = () => {
    closed = new Error("closed");
    for (const f of fail.splice(0)) f(closed);
  };
  channel.addEventListener("close", onClose);
  channel.addEventListener("error", onClose);
  return {
    next(): Promise<string | ArrayBuffer> {
      const item = queue.shift();
      if (item !== undefined) return Promise.resolve(item);
      if (closed) return Promise.reject(closed);
      return new Promise((resolve, reject) => {
        waiting.push(resolve);
        fail.push(reject);
      });
    },
    async message(): Promise<Message> {
      const item = await this.next();
      if (typeof item !== "string") throw new Error("bad-message");
      return parseMessage(item);
    },
  };
}

const send = (channel: RTCDataChannel, m: Message) => channel.send(JSON.stringify(m));

function drained(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount <= HIGH_WATER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    channel.bufferedAmountLowThreshold = LOW_WATER;
    const done = () => {
      channel.removeEventListener("bufferedamountlow", done);
      channel.removeEventListener("close", gone);
      resolve();
    };
    const gone = () => reject(new Error("closed"));
    channel.addEventListener("bufferedamountlow", done);
    channel.addEventListener("close", gone);
  });
}

export interface Outgoing {
  name: string;
  blob: Blob;
}

export type SendResult = { declined: true } | { declined: false; ok: boolean[] };

// 送出端：先送清單與每個檔案的 SHA-256，對方接受之後依序送出
export async function sendFiles({ channel, box }: Link, files: Outgoing[], onProgress: (sent: number, total: number) => void): Promise<SendResult> {
  const metas: FileMeta[] = [];
  for (const f of files) metas.push({ name: f.name, size: f.blob.size, type: f.blob.type, sha256: await sha256Blob(f.blob) });
  send(channel, { t: "files", files: metas });
  const reply = await box.message();
  if (reply.t === "decline") return { declined: true };
  if (reply.t !== "accept") throw new Error("bad-message");
  const total = totalSize(metas);
  let sent = 0;
  for (const [i, f] of files.entries()) {
    send(channel, { t: "file", i });
    for (let at = 0; at < f.blob.size; at += CHUNK) {
      await drained(channel);
      channel.send(await f.blob.slice(at, at + CHUNK).arrayBuffer());
      sent += Math.min(CHUNK, f.blob.size - at);
      onProgress(sent, total);
    }
    send(channel, { t: "end", i });
  }
  const done = await box.message();
  if (done.t !== "done" || done.ok.length !== files.length) throw new Error("bad-message");
  return { declined: false, ok: done.ok };
}

export interface Incoming {
  files: FileMeta[];
  // 讀者決定接收之後呼叫，回傳收到的檔案（SHA-256 對不上的不放進來）
  accept(onProgress: (received: number, total: number) => void): Promise<{ files: File[]; ok: boolean[] }>;
  decline(): void;
}

export class TooLargeError extends Error {
  constructor() {
    super("too-large");
  }
}

// 接收端：等對方送來清單，由讀者決定要不要接收
export async function receiveFiles({ channel, box }: Link): Promise<Incoming> {
  const offer = await box.message();
  if (offer.t !== "files") throw new Error("bad-message");
  const metas = offer.files;
  return {
    files: metas,
    decline() {
      send(channel, { t: "decline" });
    },
    async accept(onProgress) {
      const total = totalSize(metas);
      if (total > MAX_TOTAL) {
        send(channel, { t: "decline" });
        throw new TooLargeError();
      }
      send(channel, { t: "accept" });
      let received = 0;
      const out: File[] = [];
      const ok: boolean[] = [];
      for (const [i, meta] of metas.entries()) {
        const start = await box.message();
        if (start.t !== "file" || start.i !== i) throw new Error("bad-message");
        const buffer = new Uint8Array(meta.size);
        const hash = sha256.create();
        let at = 0;
        for (;;) {
          const item = await box.next();
          if (typeof item === "string") {
            const end = parseMessage(item);
            if (end.t !== "end" || end.i !== i) throw new Error("bad-message");
            break;
          }
          const chunk = new Uint8Array(item);
          if (at + chunk.length > meta.size) throw new Error("bad-message");
          buffer.set(chunk, at);
          hash.update(chunk);
          at += chunk.length;
          received += chunk.length;
          onProgress(received, total);
        }
        const good = at === meta.size && bytesToHex(hash.digest()) === meta.sha256;
        ok.push(good);
        if (good) out.push(new File([buffer], meta.name, { type: meta.type }));
      }
      send(channel, { t: "done", ok });
      return { files: out, ok };
    },
  };
}

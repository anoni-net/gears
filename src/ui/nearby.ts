// 面對面傳送：兩台裝置在同一個網路裡用 WebRTC 直接連線，不經過任何伺服器。
//
// 連線描述的編碼在 src/tools/nearby/codec.ts，傳輸的流程在 transfer.ts。這裡負責：
// - 送出端建立發起描述，接收端回應，送出端套上回應，等資料通道打開
// - 不設 STUN 與 TURN（iceServers 是空的），候選只有區網裡的位址，連線不會走到網際網路
// - 把資料通道包成 Channel（rtc-channel.ts）
//
// Tor Browser 把 WebRTC 整個關掉（RTCPeerConnection 不存在），呼叫的人先用 rtcAvailable() 檢查。

import type { Channel } from "../tools/nearby/channel.ts";
import { CodecError, type Description, buildSdp, decode, encode, fromText, offerTag, parseSdp, toText } from "../tools/nearby/codec.ts";
import { confirmCode } from "../tools/nearby/protocol.ts";
import { rtcChannel } from "../tools/nearby/rtc-channel.ts";

export const rtcAvailable = () => typeof RTCPeerConnection === "function";

// 套上回應之後多久還沒打開就判定連不上。文件站實測連得上的話 1 秒內就通，
// 公共 Wi-Fi 的裝置隔離則會一直等下去（anoni-net/docs#553）
export const CONNECT_TIMEOUT = 15_000;
// 蒐集候選最多等這麼久。區網的 host 候選通常幾十毫秒就到齊
const GATHER_TIMEOUT = 3_000;

// 找不到任何區網裡連得到的位址（沒有連上 Wi-Fi，或只剩 loopback 與 Tailscale 這類被濾掉的位址）
export class NoNetworkError extends Error {
  constructor() {
    super("no-network");
  }
}

// 解析自己這一側的描述，沒有可用的候選時改丟 NoNetworkError
function ownDescription(sdp: string, answer: boolean): Description {
  try {
    return parseSdp(sdp, answer);
  } catch (error) {
    if (error instanceof CodecError && /候選/.test(error.message)) throw new NoNetworkError();
    throw error;
  }
}

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

// 資料通道與包好的 Channel。在拿到通道的當下就包，對方早一步送來的訊息才會排進佇列
interface Link {
  dc: RTCDataChannel;
  channel: Channel;
}

function link(dc: RTCDataChannel): Link {
  dc.binaryType = "arraybuffer";
  return { dc, channel: rtcChannel(dc) };
}

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
  const local = ownDescription(pc.localDescription!.sdp, false);
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
  const local = { ...ownDescription(pc.localDescription!.sdp, true), tag: offerTag(remote.ufrag) };
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
export async function opened(p: Pending): Promise<Channel> {
  const deadline = Date.now() + CONNECT_TIMEOUT;
  const ready = await Promise.race([p.link, new Promise<never>((_, reject) => setTimeout(() => reject(new ConnectTimeoutError()), CONNECT_TIMEOUT))]);
  if (ready.dc.readyState === "open") return ready.channel;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ConnectTimeoutError()), Math.max(0, deadline - Date.now()));
    ready.dc.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ready.channel);
    });
    ready.dc.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new ConnectTimeoutError());
    });
  });
}

export const confirmOf = (p: Pending) => (p.remote ? confirmCode(p.local.fingerprint, p.remote.fingerprint) : "");

export function close(p: Pending | null) {
  p?.pc.close();
}

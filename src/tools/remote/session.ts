// 遠端傳送的續傳：包在 RelayLink 外面的 Channel，斷線接回來之後從斷掉的地方接著傳。
// 純邏輯，有單元測試（anoni-net/gears#104 的 B 版）。
//
// 傳輸的流程（src/tools/nearby/transfer.ts）不知道中間斷過線：
//
// - 每一段連線（epoch，見 RelayLink.epoch）先用 secure.ts 握手，之後的訊息都加密
// - 送出的訊息依序編號、先留在送出端的記憶體裡，對方回 ack 之後才放掉。留著的超過 WINDOW 時
//   drained() 等 ack，送出端不會把整個檔案堆在記憶體裡
// - 接回來重新握手之後，兩端先互報收到的最後一個編號（sync），送出端從下一則開始重送
// - 收到重複的編號直接略過，跳號就是對方的程式有問題，停下來
// - 自己這一端斷線時自動接回去，間隔逐漸拉長，手機切回前景時呼叫 reconnectNow() 馬上試
//
// 伺服器不保存任何東西，留著重送的是送出端自己的記憶體（principle：伺服器不保存讀者的檔案）。
//
// 加密層裡面的訊息：
//   資料   二進位，第一個位元組 0 是文字、1 是二進位，接著 8 個位元組的編號，再來是內容
//   控制   文字 JSON：{"t":"sync","got":n}、{"t":"ack","got":n}

import { type Channel, type Data, Inbox } from "../nearby/channel.ts";
import { type LinkState, RelayError, type RelayLink } from "./relay-client.ts";
import { type Role, SecureError, secure } from "./secure.ts";

// 送出之後還沒收到 ack 的上限
export const WINDOW = 8 * 1024 * 1024;
// 收到這麼多則就回一次 ack，閒下來時另外在 ACK_DELAY 之後回
const ACK_EVERY = 16;
const ACK_DELAY = 200;
// 自己斷線之後重試的間隔，最後一個一直重複，直到轉送服務說房間已經關了
export const RETRY = [0, 1000, 2000, 4000, 8000, 15000];

export type SessionState = "connecting" | "connected" | "reconnecting" | "peer-away";

interface Pending {
  seq: number;
  bytes: Uint8Array;
}

const TEXT = 0;
const BINARY = 1;

function pack(seq: number, data: Data): Uint8Array {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const out = new Uint8Array(body.length + 9);
  out[0] = typeof data === "string" ? TEXT : BINARY;
  new DataView(out.buffer).setBigUint64(1, BigInt(seq));
  out.set(body, 9);
  return out;
}

function unpack(buf: ArrayBuffer): { seq: number; data: Data } {
  if (buf.byteLength < 9) throw new Error("bad-message");
  const view = new DataView(buf);
  const kind = view.getUint8(0);
  const seq = Number(view.getBigUint64(1));
  const body = new Uint8Array(buf, 9);
  if (kind === TEXT) return { seq, data: new TextDecoder("utf-8", { fatal: true }).decode(body) };
  if (kind === BINARY) return { seq, data: body.slice().buffer };
  throw new Error("bad-message");
}

function parseControl(text: string): { t: "sync" | "ack"; got: number } {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    throw new Error("bad-message");
  }
  if ((m?.t !== "sync" && m?.t !== "ack") || !Number.isSafeInteger(m.got) || (m.got as number) < 0) throw new Error("bad-message");
  return { t: m.t, got: m.got as number };
}

export interface SessionOptions {
  retry?: number[];
}

export class RemoteSession implements Channel {
  // 第一次握手的確認碼。之後接回來重新握手，伺服器沒有 K 也冒充不了，畫面只顯示第一次的
  readonly confirm: Promise<string>;
  private resolveConfirm!: (code: string) => void;
  private rejectConfirm!: (e: Error) => void;
  private inbox = new Inbox();
  private live: Channel | null = null;
  // 這一段連線收到對方的 sync 之後才送資料，先送的會跳過對方還缺的編號
  private synced = false;
  private pending: Pending[] = [];
  private pendingBytes = 0;
  private sent = 0; // 送出的最後一個編號
  private got = 0; // 依序收到的最後一個編號
  private acked = 0; // 最後一次回給對方的 got
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];
  private ended: Error | null = null;
  private listeners = new Set<(state: SessionState) => void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private reconnecting = false;
  private resuming = false;
  private readonly retry: number[];

  constructor(
    readonly link: RelayLink,
    private readonly key: Uint8Array,
    private readonly role: Role,
    options: SessionOptions = {},
  ) {
    this.retry = options.retry ?? RETRY;
    this.confirm = new Promise((resolve, reject) => {
      this.resolveConfirm = resolve;
      this.rejectConfirm = reject;
    });
    this.confirm.catch(() => {});
    link.onState((state) => this.linkState(state));
    void this.run();
  }

  onState(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Channel ──

  send(data: Data) {
    if (this.ended) throw this.ended;
    const bytes = pack(++this.sent, data);
    this.pending.push({ seq: this.sent, bytes });
    this.pendingBytes += bytes.length;
    this.transmit(bytes);
  }

  async drained(): Promise<void> {
    for (;;) {
      if (this.ended) throw this.ended;
      if (this.pendingBytes > WINDOW || !this.live || !this.synced) {
        await new Promise<void>((resolve) => this.waiters.push(resolve));
        continue;
      }
      try {
        await this.live.drained();
      } catch {
        continue;
      }
      return;
    }
  }

  next(): Promise<Data> {
    return this.inbox.next();
  }

  close() {
    this.end(new RelayError("closed"));
    this.link.close();
  }

  // 手機切回前景時馬上試，不等下一次重試
  reconnectNow() {
    if (!this.reconnecting || this.ended) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.tryResume();
  }

  // ── 內部 ──

  private emit(state: SessionState) {
    for (const listener of this.listeners) listener(state);
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  private end(error: Error) {
    if (this.ended) return;
    this.ended = error;
    this.live = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.inbox.end(error);
    this.rejectConfirm(error);
    this.pending = [];
    this.pendingBytes = 0;
    this.wake();
  }

  private transmit(bytes: Uint8Array) {
    const live = this.live;
    if (!live || !this.synced) return;
    try {
      live.send(bytes.slice().buffer);
    } catch {
      // 連線剛斷，接回來之後重送
    }
  }

  private linkState(state: LinkState) {
    if (state === "disconnected" && !this.ended) {
      this.live = null;
      this.synced = false;
      this.reconnecting = true;
      this.attempt = 0;
      this.emit("reconnecting");
      this.scheduleResume();
    } else if (state === "away") {
      this.emit("peer-away");
    }
  }

  private scheduleResume() {
    const delay = this.retry[Math.min(this.attempt, this.retry.length - 1)]!;
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.tryResume();
    }, delay);
  }

  private async tryResume() {
    if (this.ended || !this.reconnecting || this.resuming) return;
    this.resuming = true;
    try {
      await this.link.resume();
      this.reconnecting = false;
    } catch (error) {
      // 連不上就再試，房間已經關了（等太久）就結束
      if (error instanceof RelayError && error.code === "connect") this.scheduleResume();
      else this.end(error as Error);
    } finally {
      this.resuming = false;
    }
  }

  private async run() {
    while (!this.ended) {
      const view = this.link.epoch();
      let channel: Channel;
      try {
        this.emit("connecting");
        const secured = await secure(view, this.key, this.role, view.id);
        channel = secured.channel;
        this.resolveConfirm(secured.confirm);
      } catch (error) {
        if (this.retryEpoch(error)) continue;
        return;
      }
      this.live = channel;
      this.synced = false;
      this.emit("connected");
      try {
        channel.send(JSON.stringify({ t: "sync", got: this.got }));
        this.acked = this.got;
        for (;;) this.receive(await channel.next());
      } catch (error) {
        if (this.live === channel) {
          this.live = null;
          this.synced = false;
        }
        if (!this.retryEpoch(error)) return;
      }
    }
  }

  // 這一段連線結束的原因：換了一段連線就重新握手，其他的整個結束
  private retryEpoch(error: unknown): boolean {
    if (error instanceof RelayError && error.code === "epoch") {
      this.wake();
      return true;
    }
    this.end(error instanceof RelayError || error instanceof SecureError ? error : new Error("bad-message"));
    return false;
  }

  private receive(item: Data) {
    if (typeof item === "string") {
      const m = parseControl(item);
      this.release(m.got);
      // 對方報上它收到的位置，從下一則開始重送
      if (m.t === "sync") {
        this.synced = true;
        for (const p of this.pending) this.transmit(p.bytes);
        this.wake();
      }
      return;
    }
    const { seq, data } = unpack(item);
    if (seq <= this.got) return;
    if (seq !== this.got + 1) throw new Error("bad-message");
    this.got = seq;
    this.inbox.push(data);
    if (this.got - this.acked >= ACK_EVERY) this.ack();
    else if (!this.ackTimer) this.ackTimer = setTimeout(() => this.ack(), ACK_DELAY);
  }

  private ack() {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    const live = this.live;
    if (!live || this.got === this.acked) return;
    try {
      live.send(JSON.stringify({ t: "ack", got: this.got }));
      this.acked = this.got;
    } catch {
      // 接回來時的 sync 會補上
    }
  }

  // 對方收到 got 以前的都可以放掉
  private release(got: number) {
    if (got > this.sent) throw new Error("bad-message");
    while (this.pending.length && this.pending[0]!.seq <= got) this.pendingBytes -= this.pending.shift()!.bytes.length;
    this.wake();
  }
}

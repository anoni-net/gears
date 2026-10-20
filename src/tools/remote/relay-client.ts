// 遠端傳送的瀏覽器端：連上轉送服務（server/relay.ts）開房間或加入，配對之後包成 Channel，
// 面對面傳送的傳輸流程（src/tools/nearby/transfer.ts）可以直接用。協定見 relay.ts。
//
// 只用標準的 WebSocket，瀏覽器與 Node 22 以上都有，單元測試直接連本機的轉送服務。
// 這一層不加密，送出的內容伺服器看得到。遠端傳送要在外面再包一層兩端之間的加密（anoni-net/gears#104），
// 不要直接拿這一層傳檔案。

import { type Channel, type Data, Inbox } from "../nearby/channel.ts";
import { type ClientControl, RELAY_VERSION, type RelayErrorCode, type ServerControl, frame, parseServerControl, unframe } from "./relay.ts";

export type LinkErrorCode = RelayErrorCode | "connect" | "closed" | "gone";

export class RelayError extends Error {
  constructor(readonly code: LinkErrorCode) {
    super(code);
  }
}

// away、back、gone 是對方的狀態，disconnected 是自己這一端斷線，要不要接回去（resume）由呼叫的人決定
export type LinkState = "away" | "back" | "gone" | "disconnected";

const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

// 斷線重連時關掉舊連線用的代碼。1000 代表離開，伺服器會關閉房間
const REPLACED = 4001;

interface Waiter {
  types: ServerControl["t"][];
  resolve(m: ServerControl): void;
  reject(e: Error): void;
}

export class RelayLink implements Channel {
  room = "";
  token = "";
  readonly paired: Promise<void>;
  private resolvePaired!: () => void;
  private rejectPaired!: (e: Error) => void;
  private ws: WebSocket | null = null;
  private inbox = new Inbox();
  private listeners = new Set<(state: LinkState) => void>();
  private waiter: Waiter | null = null;
  private ended = false;

  private constructor(private readonly url: string) {
    this.paired = new Promise((resolve, reject) => {
      this.resolvePaired = resolve;
      this.rejectPaired = reject;
    });
    this.paired.catch(() => {});
  }

  // 開房間，拿到房間代碼就回傳，對方加入時 paired 才完成
  static async open(url: string): Promise<RelayLink> {
    const link = new RelayLink(url);
    const m = await link.connect({ t: "open", v: RELAY_VERSION }, ["room"]);
    if (m.t === "room") {
      link.room = m.room;
      link.token = m.token;
    }
    return link;
  }

  // 加入對方開的房間，配對完成才回傳
  static async join(url: string, room: string): Promise<RelayLink> {
    const link = new RelayLink(url);
    link.room = room;
    await link.connect({ t: "join", v: RELAY_VERSION, room }, ["paired"]);
    return link;
  }

  // 自己這一端斷線之後，用同一個房間接回去。斷線期間對方送的不會補送，要靠上層的續傳
  async resume(): Promise<void> {
    if (this.ended) throw new RelayError("closed");
    const old = this.ws;
    this.ws = null;
    old?.close(REPLACED);
    await this.connect({ t: "resume", v: RELAY_VERSION, room: this.room, token: this.token }, ["resumed"]);
  }

  onState(listener: (state: LinkState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(data: Data) {
    const ws = this.ws;
    if (this.ended || !ws || ws.readyState !== WebSocket.OPEN) throw new RelayError("closed");
    ws.send(frame(data));
  }

  drained(): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.bufferedAmount <= HIGH_WATER) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
          clearInterval(timer);
          reject(new RelayError("closed"));
        } else if (ws.bufferedAmount <= LOW_WATER) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
  }

  next(): Promise<Data> {
    return this.inbox.next();
  }

  // 結束，房間跟著關閉，對方收到 gone
  close() {
    const ws = this.ws;
    this.finish(new RelayError("closed"));
    ws?.close(1000);
  }

  private connect(hello: ClientControl, expect: ServerControl["t"][]): Promise<ServerControl> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.waiter = {
        types: expect,
        resolve: (m) => {
          this.waiter = null;
          resolve(m);
        },
        reject: (e) => {
          this.waiter = null;
          reject(e);
        },
      };
      ws.addEventListener("open", () => ws.send(JSON.stringify(hello)));
      ws.addEventListener("message", (e) => {
        if (this.ws === ws) this.received(e.data);
      });
      ws.addEventListener("close", () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.waiter) this.waiter.reject(new RelayError("connect"));
        else if (!this.ended) this.emit("disconnected");
      });
    });
  }

  private received(data: unknown) {
    if (typeof data !== "string") {
      try {
        this.inbox.push(unframe(new Uint8Array(data as ArrayBuffer)));
      } catch {
        this.fail(new RelayError("bad-message"));
      }
      return;
    }
    let m: ServerControl;
    try {
      m = parseServerControl(data);
    } catch {
      return this.fail(new RelayError("bad-message"));
    }
    switch (m.t) {
      case "error":
        return this.fail(new RelayError(m.code));
      case "paired":
        if (m.token) this.token = m.token;
        this.resolvePaired();
        break;
      case "resumed":
        if (m.paired) this.resolvePaired();
        break;
      case "gone":
        this.emit("gone");
        return this.fail(new RelayError("gone"));
      case "away":
      case "back":
        this.emit(m.t);
        break;
    }
    if (this.waiter?.types.includes(m.t)) this.waiter.resolve(m);
  }

  private fail(error: RelayError) {
    this.waiter?.reject(error);
    const ws = this.ws;
    this.finish(error);
    ws?.close(1000);
  }

  private finish(error: Error) {
    this.ended = true;
    this.ws = null;
    this.inbox.end(error);
    this.rejectPaired(error);
  }

  private emit(state: LinkState) {
    for (const listener of this.listeners) listener(state);
  }
}

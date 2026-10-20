// 遠端傳送的轉送服務（anoni-net/gears#104）：開房間、配對、斷線重連，配對之後把兩端的二進位訊息
// 原樣轉給對方。協定見 src/tools/remote/relay.ts。
//
// - 不保存檔案：訊息只在轉給對方的途中經過記憶體，對方不在時直接丟掉，不寫進磁碟
// - 不記錄 IP 與房間：開房的次數只在記憶體裡計算，時間到就清掉。log 只寫啟動與程式的錯誤
// - 只聽本機，由 nginx 反向代理，clearnet 與 onion 兩個入口接到同一個程序。nginx 用 X-Relay-Client
//   標頭帶來計算開房次數用的鍵：clearnet 是讀者的 IP，onion 一律是 onion
// - 內容由兩端另外加密，這裡看不到

import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { type Ice, MAX_FRAME, NO_ICE, type RelayErrorCode, type ServerControl, parseClientControl, randomId } from "../src/tools/remote/relay.ts";

export interface RelayOptions {
  host: string;
  port: number;
  waitMs: number; // 開房之後等對方加入
  graceMs: number; // 一端斷線之後保留房間，等它接回來
  maxAgeMs: number; // 配對之後房間最長開多久
  helloMs: number; // 連上之後要在這段時間內送出第一則控制訊息
  pingMs: number; // 偵測已經斷掉、卻沒有送出關閉的連線（手機切到背景常這樣）
  maxRooms: number;
  roomBytes: number; // 每個房間轉送的上限，兩個方向合計
  openWindowMs: number;
  opensPerClient: number; // 同一個鍵在 openWindowMs 內最多開幾個房間
  opensOnion: number; // onion 的讀者共用一個鍵，上限另外設
  // 配對之後發給兩端的 TURN 伺服器與帳密（server/turn.ts）。沒有設定時是 off，兩端只用這裡轉送
  ice: () => Promise<Ice>;
}

export const DEFAULTS: RelayOptions = {
  host: "127.0.0.1",
  port: 8790,
  waitMs: 30 * 60_000,
  graceMs: 5 * 60_000,
  maxAgeMs: 6 * 3600_000,
  helloMs: 10_000,
  pingMs: 20_000,
  maxRooms: 200,
  // 面對面傳送的接收上限是 1 GB，加上加密、框與續傳重送的部分
  roomBytes: 3 * 1024 ** 3,
  openWindowMs: 10 * 60_000,
  opensPerClient: 20,
  opensOnion: 300,
  ice: async () => NO_ICE,
};

// 對方的緩衝超過這個量就暫停讀送出端，降下來再繼續
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

interface Side {
  ws: WebSocket | null;
  token: string;
  // 這一端的頁面認得 ice 控制訊息（舊版的頁面不認得，不發）
  ice?: boolean;
  away?: NodeJS.Timeout;
}

interface Room {
  id: string;
  sides: [Side, Side | null];
  bytes: number;
  epoch: number;
  ice?: Ice;
  timer: NodeJS.Timeout;
  closed: boolean;
}

interface Seat {
  room: Room;
  index: 0 | 1;
}

export interface Relay {
  url: string;
  server: Server;
  rooms(): number;
  close(): Promise<void>;
}

export async function startRelay(overrides: Partial<RelayOptions> = {}): Promise<Relay> {
  const o = { ...DEFAULTS, ...overrides };
  const rooms = new Map<string, Room>();
  const seats = new Map<WebSocket, Seat>();
  const alive = new WeakMap<WebSocket, boolean>();
  const opens = new Map<string, { count: number; reset: number }>();

  const server = createServer((_, res) => {
    res.writeHead(426, { "content-type": "text/plain" }).end("WebSocket only\n");
  });
  // 不壓縮：內容是加密過的，壓不下來
  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME, perMessageDeflate: false });

  const control = (ws: WebSocket | null, m: ServerControl) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  };
  const refuse = (ws: WebSocket, code: RelayErrorCode) => {
    control(ws, { t: "error", code });
    ws.close(1008);
  };
  const peerOf = (seat: Seat) => seat.room.sides[seat.index === 0 ? 1 : 0];

  function closeRoom(room: Room, notify: ServerControl | null) {
    if (room.closed) return;
    room.closed = true;
    rooms.delete(room.id);
    clearTimeout(room.timer);
    for (const side of room.sides) {
      if (!side) continue;
      clearTimeout(side.away);
      const ws = side.ws;
      side.ws = null;
      if (!ws) continue;
      seats.delete(ws);
      if (notify) control(ws, notify);
      ws.close(1000);
    }
  }

  function seat(ws: WebSocket, room: Room, index: 0 | 1) {
    const side = room.sides[index]!;
    clearTimeout(side.away);
    side.away = undefined;
    side.ws = ws;
    seats.set(ws, { room, index });
  }

  function allowOpen(key: string): boolean {
    const now = Date.now();
    let entry = opens.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + o.openWindowMs };
      opens.set(key, entry);
    }
    entry.count++;
    return entry.count <= (key === "onion" ? o.opensOnion : o.opensPerClient);
  }

  function hello(ws: WebSocket, text: string, key: string) {
    let m;
    try {
      m = parseClientControl(text);
    } catch (error) {
      return refuse(ws, (error as Error).message === "version" ? "version" : "bad-message");
    }
    if (m.t === "open") {
      if (!allowOpen(key)) return refuse(ws, "rate-limited");
      if (rooms.size >= o.maxRooms) return refuse(ws, "busy");
      const room: Room = {
        id: randomId(),
        sides: [{ ws: null, token: randomId(), ice: m.ice }, null],
        bytes: 0,
        epoch: 0,
        timer: setTimeout(() => closeRoom(room, { t: "gone" }), o.waitMs),
        closed: false,
      };
      rooms.set(room.id, room);
      seat(ws, room, 0);
      return control(ws, { t: "room", room: room.id, token: room.sides[0].token });
    }
    const room = rooms.get(m.room);
    if (!room) return refuse(ws, "no-room");
    if (m.t === "join") {
      if (room.sides[1]) return refuse(ws, "room-full");
      room.sides[1] = { ws: null, token: randomId(), ice: m.ice };
      clearTimeout(room.timer);
      room.timer = setTimeout(() => closeRoom(room, { t: "gone" }), o.maxAgeMs);
      seat(ws, room, 1);
      control(ws, { t: "paired", token: room.sides[1].token });
      control(room.sides[0].ws, { t: "paired" });
      if (!room.sides[0].ws) control(ws, { t: "away" });
      // TURN 的帳密兩端共用一組，效期跟房間配對之後的上限相同
      void o.ice().then((ice) => {
        if (room.closed) return;
        room.ice = ice;
        for (const side of room.sides) if (side?.ice) control(side.ws, { t: "ice", ...ice });
      });
      return;
    }
    const index = room.sides.findIndex((s) => s?.token === m.token);
    if (index < 0) return refuse(ws, "no-room");
    const side = room.sides[index]!;
    side.ice = m.ice;
    const old = side.ws;
    if (old) {
      // 伺服器還沒發現舊的連線斷了，讀者已經接回來
      seats.delete(old);
      old.terminate();
    }
    seat(ws, room, index as 0 | 1);
    const peer = room.sides[index === 0 ? 1 : 0];
    const epoch = ++room.epoch;
    control(ws, { t: "resumed", paired: !!peer, epoch });
    // 配對時不在的一端接回來時補上 TURN 的帳密
    if (room.ice && side.ice) control(ws, { t: "ice", ...room.ice });
    // 對方一律收到 back，就算它沒發現這一端斷過：接回來的一端會重新握手，對方也要跟著換
    if (peer?.ws) control(peer.ws, { t: "back", epoch });
    else if (peer) control(ws, { t: "away" });
  }

  function forward(from: WebSocket, seated: Seat, data: Buffer) {
    const { room } = seated;
    const to = peerOf(seated)?.ws;
    // 對方不在時丟掉，不替它留著。續傳由上層補回來
    if (!to) return;
    room.bytes += data.length;
    if (room.bytes > o.roomBytes) {
      for (const side of room.sides) control(side?.ws ?? null, { t: "error", code: "quota" });
      return closeRoom(room, null);
    }
    to.send(data, { binary: true });
    if (to.bufferedAmount > HIGH_WATER && !from.isPaused) {
      from.pause();
      const check = setInterval(() => {
        if (to.readyState !== to.OPEN || from.readyState !== from.OPEN || to.bufferedAmount <= LOW_WATER) {
          clearInterval(check);
          if (from.readyState === from.OPEN) from.resume();
        }
      }, 20);
    }
  }

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const header = req.headers["x-relay-client"];
    const key = (Array.isArray(header) ? header[0] : header) || req.socket.remoteAddress || "";
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("error", () => {});
    const helloTimer = setTimeout(() => {
      if (!seats.has(ws)) refuse(ws, "bad-message");
    }, o.helloMs);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      const seated = seats.get(ws);
      if (!seated) {
        if (isBinary) return refuse(ws, "bad-message");
        clearTimeout(helloTimer);
        return hello(ws, data.toString(), key);
      }
      // 配對之後只收二進位
      if (!isBinary || !peerOf(seated)) {
        seats.delete(ws);
        seated.room.sides[seated.index]!.ws = null;
        refuse(ws, "bad-message");
        return closeRoom(seated.room, { t: "gone" });
      }
      forward(ws, seated, data as Buffer);
    });

    ws.on("close", (code: number) => {
      clearTimeout(helloTimer);
      const seated = seats.get(ws);
      if (!seated) return;
      seats.delete(ws);
      const { room, index } = seated;
      const side = room.sides[index]!;
      if (side.ws !== ws) return;
      side.ws = null;
      // 1000 是讀者按了結束或傳完，房間跟著關閉。其他的先當成暫時離開
      if (code === 1000) return closeRoom(room, { t: "gone" });
      control(peerOf(seated)?.ws ?? null, { t: "away" });
      side.away = setTimeout(() => closeRoom(room, { t: "gone" }), o.graceMs);
    });
  });

  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
    const now = Date.now();
    for (const [key, entry] of opens) if (entry.reset <= now) opens.delete(key);
  }, o.pingMs);

  await new Promise<void>((resolve) => server.listen(o.port, o.host, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `ws://${o.host}:${port}/`,
    server,
    rooms: () => rooms.size,
    async close() {
      clearInterval(ping);
      for (const room of [...rooms.values()]) closeRoom(room, null);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// 遠端傳送的轉送服務：瀏覽器與伺服器（server/relay.ts）之間的控制訊息。純邏輯，兩邊共用，有單元測試。
//
// 一條 WebSocket，配對之前只有控制訊息（JSON 文字）：
//
//   開房的一端 → {"t":"open","v":1}                          ← {"t":"room","room":…,"token":…}
//   加入的一端 → {"t":"join","v":1,"room":…}                 ← {"t":"paired","token":…}，開房的一端收到 {"t":"paired"}
//   斷線重連   → {"t":"resume","v":1,"room":…,"token":…}     ← {"t":"resumed","paired":…,"epoch":n}，對方收到 {"t":"back","epoch":n}
//
// 配對之後，兩端送的一律是二進位，伺服器原樣轉給對方，不看內容、不保存。伺服器送來的文字仍然是
// 控制訊息（away、back、gone、error），所以兩者不會混在一起。要送文字時包成一個框（frame）：
// 第一個位元組 0 是文字（UTF-8）、1 是二進位，接著是內容。遠端傳送的加密之後也套在框外面。
//
// 斷線：用 close 的 1000 關掉代表離開，房間跟著關閉。其他的斷線（手機切到背景、網路中斷）先當成
// 暫時離開，對方收到 away，在 GRACE 之內用房間代碼與自己的 token 接回來，對方收到 back（就算它沒收到 away）。伺服器不替不在的那一端
// 留著訊息，對方不在時送的會被丟掉，要靠上層的續傳補回來（anoni-net/gears#104）。
//
// 配對之後伺服器另外送一則 ice：經過 TURN 建立 WebRTC 資料通道用的伺服器與帳密（A 版，direct.ts）。
// policy 是 relay 時只能經過 TURN，兩端看不到彼此的 IP。沒有設定 TURN 時是 off。all 只給測試用，
// 允許區網的位址，在沒有 TURN 的機器上也能建立資料通道。
//
// epoch 是這個房間第幾段連線，每次有一端接回來就加一，兩端收到同一個數字。接回來之後兩端重新握手
// （secure.ts），握手時用它認出上一段連線還在路上的訊息。

export const RELAY_VERSION = 1;

// 一則訊息的上限：檔案一塊 64 KB，加上框、加密與續傳的欄位，留一些空間
export const MAX_FRAME = 256 * 1024;

// 房間代碼與 token：16 個隨機位元組的 base64url，22 個字元
const ID = /^[A-Za-z0-9_-]{22}$/;
export const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ice：這一端認得伺服器發的 ice 控制訊息。舊版的頁面不帶，伺服器就不發，免得當成不合格的訊息斷線
export type ClientControl =
  | { t: "open"; v: number; ice?: boolean }
  | { t: "join"; v: number; room: string; ice?: boolean }
  | { t: "resume"; v: number; room: string; token: string; ice?: boolean };

export type RelayErrorCode =
  | "version" // 協定版本對不上，請讀者重新整理
  | "bad-message"
  | "no-room" // 房間不存在、已經關閉或過期
  | "room-full" // 已經配對過
  | "busy" // 同時開著的房間太多
  | "rate-limited" // 開房太頻繁
  | "quota"; // 這個房間的流量用完了

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface Ice {
  policy: "relay" | "all" | "off";
  servers: IceServer[];
}

export const NO_ICE: Ice = { policy: "off", servers: [] };

export type ServerControl =
  | { t: "room"; room: string; token: string }
  | { t: "paired"; token?: string }
  | { t: "resumed"; paired: boolean; epoch: number }
  | { t: "away" }
  | { t: "back"; epoch: number }
  | { t: "gone" }
  | ({ t: "ice" } & Ice)
  | { t: "error"; code: RelayErrorCode };

// TURN 的網址只收 turn: 與 turns:，帳密是短字串
function parseIce(m: Record<string, unknown>): Ice {
  if (m.policy !== "relay" && m.policy !== "all" && m.policy !== "off") throw new Error("bad-message");
  if (!Array.isArray(m.servers) || m.servers.length > 4) throw new Error("bad-message");
  const short = (v: unknown) => v === undefined || (typeof v === "string" && v.length <= 512);
  const servers = m.servers.map((s: Record<string, unknown>) => {
    if (!s || !Array.isArray(s.urls) || !s.urls.length || s.urls.length > 8) throw new Error("bad-message");
    if (!s.urls.every((u: unknown) => typeof u === "string" && /^turns?:[^\s]{1,200}$/.test(u))) throw new Error("bad-message");
    if (!short(s.username) || !short(s.credential)) throw new Error("bad-message");
    const out: IceServer = { urls: s.urls as string[] };
    if (s.username !== undefined) out.username = s.username as string;
    if (s.credential !== undefined) out.credential = s.credential as string;
    return out;
  });
  return { policy: m.policy, servers };
}

const isEpoch = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

const ERRORS: RelayErrorCode[] = ["version", "bad-message", "no-room", "room-full", "busy", "rate-limited", "quota"];

function parseJson(text: string): Record<string, unknown> {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    throw new Error("bad-message");
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("bad-message");
  return m as Record<string, unknown>;
}

// 伺服器讀瀏覽器送來的控制訊息。版本對不上另外丟 version，伺服器據此回覆
export function parseClientControl(text: string): ClientControl {
  const m = parseJson(text);
  if (m.t !== "open" && m.t !== "join" && m.t !== "resume") throw new Error("bad-message");
  if (m.v !== RELAY_VERSION) throw new Error("version");
  const ice = m.ice === true ? { ice: true } : {};
  if (m.t === "open") return { t: "open", v: RELAY_VERSION, ...ice };
  if (!isId(m.room)) throw new Error("bad-message");
  if (m.t === "join") return { t: "join", v: RELAY_VERSION, room: m.room, ...ice };
  if (!isId(m.token)) throw new Error("bad-message");
  return { t: "resume", v: RELAY_VERSION, room: m.room, token: m.token, ...ice };
}

// 瀏覽器讀伺服器送來的控制訊息
export function parseServerControl(text: string): ServerControl {
  const m = parseJson(text);
  switch (m.t) {
    case "room":
      if (!isId(m.room) || !isId(m.token)) throw new Error("bad-message");
      return { t: "room", room: m.room, token: m.token };
    case "paired":
      if (m.token !== undefined && !isId(m.token)) throw new Error("bad-message");
      return m.token === undefined ? { t: "paired" } : { t: "paired", token: m.token };
    case "resumed":
      if (typeof m.paired !== "boolean" || !isEpoch(m.epoch)) throw new Error("bad-message");
      return { t: "resumed", paired: m.paired, epoch: m.epoch };
    case "back":
      if (!isEpoch(m.epoch)) throw new Error("bad-message");
      return { t: "back", epoch: m.epoch };
    case "away":
    case "gone":
      return { t: m.t };
    case "ice":
      return { t: "ice", ...parseIce(m) };
    case "error":
      if (!ERRORS.includes(m.code as RelayErrorCode)) throw new Error("bad-message");
      return { t: "error", code: m.code as RelayErrorCode };
    default:
      throw new Error("bad-message");
  }
}

// ── 框 ──────────────────────────────────────────────────────────────────────

const TEXT = 0;
const BINARY = 1;

export function frame(data: string | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const body = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const out = new Uint8Array(body.length + 1);
  out[0] = typeof data === "string" ? TEXT : BINARY;
  out.set(body, 1);
  return out;
}

export function unframe(bytes: Uint8Array): string | ArrayBuffer {
  if (!bytes.length) throw new Error("bad-message");
  const body = bytes.subarray(1);
  if (bytes[0] === TEXT) return new TextDecoder("utf-8", { fatal: true }).decode(body);
  if (bytes[0] === BINARY) return body.slice().buffer;
  throw new Error("bad-message");
}

// 遠端傳送的兩端之間的加密：包在 RelayLink（或任何 Channel）外面，轉送服務只拿得到公鑰與密文。
// 純邏輯，有單元測試（anoni-net/gears#104 的 B 版）。
//
// 連結金鑰 K（32 位元組）由開房的一端產生，放在分享連結的 # 後面，不會送到伺服器。配對之後：
//
// 1. 兩端各產生一組暫時的 X25519 金鑰，用明文交換公鑰。開房的一端先送公鑰的雜湊
//    {"t":"hello","v":2,"e":epoch,"commit":…}，加入的一端回 {"t":"hello","v":2,"e":epoch,"key":…}，
//    開房的一端再揭露 {"t":"reveal","e":epoch,"key":…}。確認碼只有 6 位數，不先承諾的話，中間的人
//    看到雙方的公鑰之後試一百萬把金鑰就能讓兩邊的確認碼相同（版本 1 是兩端同時送出公鑰）
// 2. 共同推出的值當輸入、K 當 salt，用 HKDF-SHA256 導出兩把金鑰，每個方向一把。info 帶協定版本與
//    兩端的公鑰（開房的一端在前），公鑰在途中被換掉的話，兩邊導出的金鑰就不同
// 3. 之後每則訊息先包成框（relay.ts 的 frame，分文字與二進位），用 AES-256-GCM 加密。nonce 是遞增的
//    序號，順序不對、重複或被改過的都解不開，通道就關閉
// 4. 第一則加密的訊息是 ready。K 不對（連結不完整）時在這裡就解不開
// 5. 確認碼由兩端的公鑰算出（沿用面對面傳送的 confirmCode）。伺服器不知道 K，解不開、也冒充不了
//    任何一端。連結外洩、別人用它搶先加入時，真正的接收端進不了房間，或兩人核對確認碼時對不上
//
// 斷線重連時，轉送服務丟掉的訊息讓序號對不上，所以每次接回來都重新握手（同一個 K、新的暫時金鑰），
// 序號從頭算，再由上層的續傳接著傳。重新握手時把第一次握手導出的秘密（chain）算進 salt，讀者核對過的
// 確認碼才涵蓋得到之後的每一段連線。

import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Channel, Data } from "../nearby/channel.ts";
import { confirmCode } from "../nearby/protocol.ts";
import { frame, unframe } from "./relay.ts";

export const SECURE_VERSION = 2;
export const LINK_KEY_BYTES = 32;

export type Role = "opener" | "joiner";

export type SecureErrorCode = "wrong-key" | "tampered" | "bad-hello" | "version";

export class SecureError extends Error {
  constructor(readonly code: SecureErrorCode) {
    super(code);
  }
}

export const newLinkKey = () => crypto.getRandomValues(new Uint8Array(LINK_KEY_BYTES));

const b64url = (bytes: Uint8Array) => {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function fromB64url(text: string, length: number): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  let bin: string;
  try {
    bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  if (bin.length !== length) return null;
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// 分享連結裡的金鑰
export const encodeKey = (key: Uint8Array) => b64url(key);
export const decodeKey = (text: string) => fromB64url(text, LINK_KEY_BYTES);

const INFO = new TextEncoder().encode(`gears remote v${SECURE_VERSION}`);

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function nonce(counter: number): Uint8Array {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setBigUint64(4, BigInt(counter));
  return n;
}

const asBuffer = (u8: Uint8Array): ArrayBuffer =>
  u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? (u8.buffer as ArrayBuffer) : (u8.slice().buffer as ArrayBuffer);

// 握手的一則明文訊息。斷線重連之後，上一段連線還在路上的訊息可能先到：二進位的與 epoch 比較舊的略過
async function readStep(inner: Channel, epoch: number, type: "hello" | "reveal"): Promise<Record<string, unknown>> {
  for (;;) {
    const item = await inner.next();
    if (typeof item !== "string") {
      if (epoch > 0) continue;
      throw new SecureError("bad-hello");
    }
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(item);
    } catch {
      throw new SecureError("bad-hello");
    }
    if (!m || typeof m !== "object") throw new SecureError("bad-hello");
    if (m.t === "hello" && m.v !== SECURE_VERSION) throw new SecureError("version");
    if (typeof m.e === "number" && m.e < epoch) continue;
    if (m.t !== type || m.e !== epoch) throw new SecureError("bad-hello");
    return m;
  }
}

const field = (m: Record<string, unknown>, name: string): Uint8Array => {
  const value = typeof m[name] === "string" ? fromB64url(m[name] as string, 32) : null;
  if (!value) throw new SecureError("bad-hello");
  return value;
};

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// 交換公鑰。開房的一端先送公鑰的雜湊，收到對方的公鑰才揭露自己的，加入的一端確認揭露的公鑰跟雜湊
// 相符。兩端都要在看到對方的公鑰之前決定自己的，中間的人沒有辦法一直換金鑰、試到兩邊的確認碼相同
async function exchange(inner: Channel, role: Role, epoch: number, mine: Uint8Array): Promise<Uint8Array> {
  const say = (m: Record<string, unknown>) => inner.send(JSON.stringify(m));
  if (role === "opener") {
    say({ t: "hello", v: SECURE_VERSION, e: epoch, commit: b64url(sha256(mine)) });
    const theirs = field(await readStep(inner, epoch, "hello"), "key");
    say({ t: "reveal", e: epoch, key: b64url(mine) });
    return theirs;
  }
  let hello: Record<string, unknown>;
  try {
    hello = await readStep(inner, epoch, "hello");
  } catch (error) {
    // 對方是別的版本：加入的一端還沒送過任何東西，補一則 hello，對方才知道是版本對不上
    if (error instanceof SecureError && error.code === "version") say({ t: "hello", v: SECURE_VERSION, e: epoch });
    throw error;
  }
  const commit = field(hello, "commit");
  say({ t: "hello", v: SECURE_VERSION, e: epoch, key: b64url(mine) });
  const theirs = field(await readStep(inner, epoch, "reveal"), "key");
  if (!equal(sha256(theirs), commit)) throw new SecureError("bad-hello");
  return theirs;
}

export interface Secured {
  channel: Channel;
  // 兩端的公鑰算出的 6 位數，兩邊相同才是同一條連線
  confirm: string;
  // 這次握手導出的秘密。第一次握手的那一份交給之後每一次握手（prior），見 secure()
  chain: Uint8Array;
}

// 在 inner 上握手，回傳加密過的通道。K 不對時丟出 wrong-key，對方送來的不是合格的公鑰時丟出 bad-hello。
// epoch 是轉送服務給的連線編號（RelayLink.epoch），沒有斷過線時是 0。
//
// prior 是第一次握手的 chain，斷線接回來重新握手時帶上。讀者只核對第一次握手的確認碼，不帶 prior 的話，
// 知道連結金鑰的中間人可以等兩人核對完、讓連線斷一次，在重新握手時才換掉公鑰。帶了之後，沒有參與
// 第一次握手的人導不出金鑰，在 ready 就停下來
export async function secure(inner: Channel, linkKey: Uint8Array, role: Role, epoch = 0, prior?: Uint8Array): Promise<Secured> {
  const secret = x25519.utils.randomSecretKey();
  const mine = x25519.getPublicKey(secret);
  let theirs: Uint8Array;
  try {
    theirs = await exchange(inner, role, epoch, mine);
  } catch (error) {
    // 對方送來的不合格時關掉通道，另一端才不會一直等。版本不同時留著，剛送出的 hello 要讓對方收到
    if (error instanceof SecureError && error.code !== "version") inner.close();
    throw error;
  }

  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secret, theirs);
  } catch {
    throw new SecureError("bad-hello");
  }
  const [first, second] = role === "opener" ? [mine, theirs] : [theirs, mine];
  const salt = prior ? sha256(concat(linkKey, prior)) : linkKey;
  const keys = hkdf(sha256, shared, salt, concat(INFO, first, second), 96);
  const openerKey = keys.subarray(0, 32);
  const joinerKey = keys.subarray(32, 64);
  const chain = keys.slice(64);
  const sendKey = role === "opener" ? openerKey : joinerKey;
  const recvKey = role === "opener" ? joinerKey : openerKey;
  let sent = 0;
  let received = 0;

  const seal = (data: Data) => asBuffer(gcm(sendKey, nonce(sent++)).encrypt(frame(data)));
  const open = (item: Data, onFail: SecureErrorCode): Data => {
    if (typeof item === "string") throw new SecureError("tampered");
    let plain: Uint8Array;
    try {
      plain = gcm(recvKey, nonce(received)).decrypt(new Uint8Array(item));
    } catch {
      throw new SecureError(onFail);
    }
    received++;
    return unframe(plain);
  };

  const channel: Channel = {
    send: (data) => inner.send(seal(data)),
    drained: () => inner.drained(),
    async next() {
      try {
        return open(await inner.next(), "tampered");
      } catch (error) {
        if (error instanceof SecureError) inner.close();
        throw error;
      }
    },
    close: () => inner.close(),
  };

  // 第一則加密的訊息確認兩端導出同一把金鑰
  inner.send(seal('{"t":"ready"}'));
  try {
    if (open(await inner.next(), "wrong-key") !== '{"t":"ready"}') throw new SecureError("wrong-key");
  } catch (error) {
    if (error instanceof SecureError) inner.close();
    throw error;
  }
  return { channel, confirm: confirmCode(mine, theirs), chain };
}

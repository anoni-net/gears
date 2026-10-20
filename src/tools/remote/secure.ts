// 遠端傳送的兩端之間的加密：包在 RelayLink（或任何 Channel）外面，轉送服務只拿得到公鑰與密文。
// 純邏輯，有單元測試（anoni-net/gears#104 的 B 版）。
//
// 連結金鑰 K（32 位元組）由開房的一端產生，放在分享連結的 # 後面，不會送到伺服器。配對之後：
//
// 1. 兩端各產生一組暫時的 X25519 金鑰，用明文交換公鑰：{"t":"hello","v":1,"e":epoch,"key":…}
// 2. 共同推出的值當輸入、K 當 salt，用 HKDF-SHA256 導出兩把金鑰，每個方向一把。info 帶協定版本與
//    兩端的公鑰（開房的一端在前），公鑰在途中被換掉的話，兩邊導出的金鑰就不同
// 3. 之後每則訊息先包成框（relay.ts 的 frame，分文字與二進位），用 AES-256-GCM 加密。nonce 是遞增的
//    序號，順序不對、重複或被改過的都解不開，通道就關閉
// 4. 第一則加密的訊息是 ready。K 不對（連結不完整）時在這裡就解不開
// 5. 確認碼由兩端的公鑰算出（沿用面對面傳送的 confirmCode）。伺服器不知道 K，解不開、也冒充不了
//    任何一端。連結外洩、別人用它搶先加入時，真正的接收端進不了房間，或兩人核對確認碼時對不上
//
// 斷線重連時，轉送服務丟掉的訊息讓序號對不上，所以每次接回來都重新握手（同一個 K、新的暫時金鑰），
// 序號從頭算，再由上層的續傳接著傳。

import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Channel, Data } from "../nearby/channel.ts";
import { confirmCode } from "../nearby/protocol.ts";
import { frame, unframe } from "./relay.ts";

export const SECURE_VERSION = 1;
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

// 對方的 hello。斷線重連之後，上一段連線還在路上的訊息可能先到：二進位的與 epoch 比較舊的 hello 略過
async function readHello(inner: Channel, epoch: number): Promise<Uint8Array> {
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
    if (!m || m.t !== "hello") throw new SecureError("bad-hello");
    if (m.v !== SECURE_VERSION) throw new SecureError("version");
    if (typeof m.e === "number" && m.e < epoch) continue;
    if (m.e !== epoch) throw new SecureError("bad-hello");
    const key = typeof m.key === "string" ? fromB64url(m.key, 32) : null;
    if (!key) throw new SecureError("bad-hello");
    return key;
  }
}

export interface Secured {
  channel: Channel;
  // 兩端的公鑰算出的 6 位數，兩邊相同才是同一條連線
  confirm: string;
}

// 在 inner 上握手，回傳加密過的通道。K 不對時丟出 wrong-key，對方送來的不是合格的公鑰時丟出 bad-hello。
// epoch 是轉送服務給的連線編號（RelayLink.epoch），沒有斷過線時是 0
export async function secure(inner: Channel, linkKey: Uint8Array, role: Role, epoch = 0): Promise<Secured> {
  const secret = x25519.utils.randomSecretKey();
  const mine = x25519.getPublicKey(secret);
  inner.send(JSON.stringify({ t: "hello", v: SECURE_VERSION, e: epoch, key: b64url(mine) }));
  const theirs = await readHello(inner, epoch);

  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secret, theirs);
  } catch {
    throw new SecureError("bad-hello");
  }
  const [first, second] = role === "opener" ? [mine, theirs] : [theirs, mine];
  const keys = hkdf(sha256, shared, linkKey, concat(INFO, first, second), 64);
  const openerKey = keys.subarray(0, 32);
  const joinerKey = keys.subarray(32);
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
  return { channel, confirm: confirmCode(mine, theirs) };
}

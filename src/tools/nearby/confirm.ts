// 面對面傳送的確認碼用的隨機數：資料通道連上之後、傳檔案之前，兩端各出一個隨機數算進確認碼。
// 純邏輯，有單元測試。
//
// 確認碼只有 6 位數。只用兩邊的 DTLS 指紋算的話，在中間換掉連線描述的人（複製貼上經過的伺服器）
// 可以一直換憑證，試到兩邊的確認碼相同，大約一百萬次。所以加上兩端的隨機數，而且先承諾再揭露：
//
//   發起的一端 → {"t":"nonce-commit","v":1,"c":雜湊}
//   回應的一端 → {"t":"nonce","n":隨機數}
//   發起的一端 → {"t":"nonce-reveal","n":隨機數}，回應的一端確認跟先前的雜湊相符
//
// 兩端都要在看到對方的隨機數之前決定自己的。中間的人跟兩邊各有一條連線，兩邊的確認碼各自由一個
// 它決定不了的隨機數算出來，相同的機會是一百萬分之一，試不了第二次。
//
// 對方送來的第一則不是這裡的訊息（舊版的頁面直接送檔案清單）時丟出 version，不退回舊的做法：
// 中間的人只要假裝成舊版就能繞過。

import { sha256 } from "@noble/hashes/sha2.js";
import type { Channel } from "./channel.ts";

export const NONCE_VERSION = 1;
const NONCE_BYTES = 16;

export type NonceRole = "offer" | "answer";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(value: unknown, length: number): Uint8Array {
  if (typeof value !== "string" || value.length !== length * 2 || !/^[0-9a-f]+$/.test(value)) throw new Error("bad-message");
  return Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
}

async function read(channel: Channel, type: string): Promise<Record<string, unknown>> {
  const item = await channel.next();
  if (typeof item !== "string") throw new Error("version");
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(item);
  } catch {
    throw new Error("bad-message");
  }
  if (!m || typeof m !== "object") throw new Error("bad-message");
  // 別的版本：舊版直接送檔案清單，之後的版本可能換了這裡的格式
  if (m.t !== type || (type === "nonce-commit" && m.v !== NONCE_VERSION)) throw new Error("version");
  return m;
}

// 回傳兩端的隨機數接在一起（發起的一端在前），交給 confirmCode 的第三個參數
export async function agreeNonces(
  channel: Channel,
  role: NonceRole,
  random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(NONCE_BYTES)),
): Promise<Uint8Array> {
  const mine = random();
  const say = (m: Record<string, unknown>) => channel.send(JSON.stringify(m));
  let offer: Uint8Array;
  let answer: Uint8Array;
  if (role === "offer") {
    say({ t: "nonce-commit", v: NONCE_VERSION, c: hex(sha256(mine)) });
    answer = fromHex((await read(channel, "nonce")).n, NONCE_BYTES);
    say({ t: "nonce-reveal", n: hex(mine) });
    offer = mine;
  } else {
    const commit = fromHex((await read(channel, "nonce-commit")).c, 32);
    say({ t: "nonce", n: hex(mine) });
    offer = fromHex((await read(channel, "nonce-reveal")).n, NONCE_BYTES);
    if (hex(sha256(offer)) !== hex(commit)) throw new Error("bad-message");
    answer = mine;
  }
  const out = new Uint8Array(NONCE_BYTES * 2);
  out.set(offer);
  out.set(answer, NONCE_BYTES);
  return out;
}

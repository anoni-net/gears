// 傳送檔案的流程，用在任何一條 Channel 上（channel.ts）。純邏輯，有單元測試。
//
// - 送出端先送清單與每個檔案的 SHA-256，接收端的讀者按「接收」才開始傳，別人不能把檔案直接塞過來
// - 64 KB 一塊，每塊送出前等通道的緩衝降下來
// - 接收端邊收邊算 SHA-256，對不上的不交出去
//
// 訊息格式見 protocol.ts。

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256Blob } from "../verify/hash.ts";
import type { Channel } from "./channel.ts";
import { CHUNK, type FileMeta, MAX_TOTAL, type Message, parseMessage, totalSize } from "./protocol.ts";

const send = (channel: Channel, m: Message) => channel.send(JSON.stringify(m));

async function message(channel: Channel): Promise<Message> {
  const item = await channel.next();
  if (typeof item !== "string") throw new Error("bad-message");
  return parseMessage(item);
}

export interface Outgoing {
  name: string;
  blob: Blob;
}

export type SendResult = { declined: true } | { declined: false; ok: boolean[] };

// 送出端：先送清單與每個檔案的 SHA-256，對方接受之後依序送出
export async function sendFiles(channel: Channel, files: Outgoing[], onProgress: (sent: number, total: number) => void): Promise<SendResult> {
  const metas: FileMeta[] = [];
  for (const f of files) metas.push({ name: f.name, size: f.blob.size, type: f.blob.type, sha256: await sha256Blob(f.blob) });
  send(channel, { t: "files", files: metas });
  const reply = await message(channel);
  if (reply.t === "decline") return { declined: true };
  if (reply.t !== "accept") throw new Error("bad-message");
  const total = totalSize(metas);
  let sent = 0;
  for (const [i, f] of files.entries()) {
    send(channel, { t: "file", i });
    for (let at = 0; at < f.blob.size; at += CHUNK) {
      await channel.drained();
      channel.send(await f.blob.slice(at, at + CHUNK).arrayBuffer());
      sent += Math.min(CHUNK, f.blob.size - at);
      onProgress(sent, total);
    }
    send(channel, { t: "end", i });
  }
  const done = await message(channel);
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
export async function receiveFiles(channel: Channel): Promise<Incoming> {
  const offer = await message(channel);
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
        const start = await message(channel);
        if (start.t !== "file" || start.i !== i) throw new Error("bad-message");
        const buffer = new Uint8Array(meta.size);
        const hash = sha256.create();
        let at = 0;
        for (;;) {
          const item = await channel.next();
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

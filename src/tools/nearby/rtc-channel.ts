// WebRTC 的資料通道包成 Channel（channel.ts）。面對面傳送與遠端傳送經過 TURN 的那一條共用。
// 要在拿到資料通道的當下就包，對方早一步送來的訊息才會排進佇列

import { type Channel, Inbox } from "./channel.ts";

// 送出端的緩衝超過這個量就停下來等
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

export function rtcChannel(dc: RTCDataChannel): Channel {
  dc.binaryType = "arraybuffer";
  const inbox = new Inbox();
  dc.addEventListener("message", (e) => inbox.push(e.data));
  dc.addEventListener("close", () => inbox.end());
  dc.addEventListener("error", () => inbox.end());
  return {
    send: (data) => (typeof data === "string" ? dc.send(data) : dc.send(data)),
    drained: () => drained(dc),
    next: () => inbox.next(),
    close: () => dc.close(),
  };
}

function drained(dc: RTCDataChannel): Promise<void> {
  if (dc.bufferedAmount <= HIGH_WATER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    dc.bufferedAmountLowThreshold = LOW_WATER;
    const done = () => {
      dc.removeEventListener("bufferedamountlow", done);
      dc.removeEventListener("close", gone);
      resolve();
    };
    const gone = () => reject(new Error("closed"));
    dc.addEventListener("bufferedamountlow", done);
    dc.addEventListener("close", gone);
  });
}

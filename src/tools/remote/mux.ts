// 遠端傳送的一條連線分成檔案、文字訊息與信令三條 Channel。純邏輯，有單元測試（anoni-net/gears#104）。
//
// 每則訊息加上一個標記：文字的第一個字元、二進位的第一個位元組，f 是檔案、m 是文字訊息、
// s 是建立 WebRTC 資料通道的信令（direct.ts）。
// 檔案的傳輸流程（src/tools/nearby/transfer.ts）只看得到自己那一條，不知道中間夾著文字訊息。
// 包在 RemoteSession 裡面，所以文字訊息一樣加密、斷線接回來之後一樣補送。

import { type Channel, type Data, Inbox } from "../nearby/channel.ts";

export type Lane = "f" | "m" | "s";

// 一則文字訊息的上限，字元數
export const MAX_MESSAGE = 2000;

const BYTE: Record<Lane, number> = { f: 0x66, m: 0x6d, s: 0x73 };

function tag(lane: Lane, data: Data): Data {
  if (typeof data === "string") return lane + data;
  const out = new Uint8Array(data.byteLength + 1);
  out[0] = BYTE[lane];
  out.set(new Uint8Array(data), 1);
  return out.buffer;
}

function untag(data: Data): { lane: Lane; data: Data } {
  if (typeof data === "string") {
    const lane = data[0] as Lane;
    if (!(lane in BYTE)) throw new Error("bad-message");
    return { lane, data: data.slice(1) };
  }
  const bytes = new Uint8Array(data);
  const lane = (Object.keys(BYTE) as Lane[]).find((l) => BYTE[l] === bytes[0]);
  if (!lane) throw new Error("bad-message");
  return { lane, data: bytes.slice(1).buffer };
}

export interface Lanes {
  files: Channel;
  messages: Channel;
  signals: Channel;
}

// 從 inner 讀出來的訊息依標記分到各條。inner 結束或收到不合格的訊息時，每一條都一起結束
export function split(inner: Channel): Lanes {
  const boxes: Record<Lane, Inbox> = { f: new Inbox(), m: new Inbox(), s: new Inbox() };
  void (async () => {
    try {
      for (;;) {
        const { lane, data } = untag(await inner.next());
        boxes[lane].push(data);
      }
    } catch (error) {
      for (const box of Object.values(boxes)) box.end(error as Error);
    }
  })();
  const lane = (name: Lane): Channel => ({
    send: (data) => inner.send(tag(name, data)),
    drained: () => inner.drained(),
    next: () => boxes[name].next(),
    close: () => inner.close(),
  });
  return { files: lane("f"), messages: lane("m"), signals: lane("s") };
}

import { type Channel, type Data, Inbox } from "../../src/tools/nearby/channel.ts";

// 記憶體裡的一對通道，送出的訊息複製一份、在下一個 microtask 交給對方，跟真的通道一樣不同步。
// hook 看得到每一則經過的訊息（from 是送出的那一端），可以改掉內容，回傳 null 就丟掉，
// 用來模擬途中的伺服器
export function wire(hook: (from: 0 | 1, data: Data) => Data | null = (_, d) => d): [Channel, Channel] {
  const boxes = [new Inbox(), new Inbox()] as const;
  const end = (from: 0 | 1): Channel => {
    const mine = boxes[from];
    const theirs = boxes[from === 0 ? 1 : 0];
    return {
      send(data) {
        const copy = hook(from, typeof data === "string" ? data : data.slice(0));
        if (copy !== null) queueMicrotask(() => theirs.push(copy));
      },
      drained: () => Promise.resolve(),
      next: () => mine.next(),
      close() {
        mine.end();
        theirs.end();
      },
    };
  };
  return [end(0), end(1)];
}

// 只改第一端送出的訊息
export const pair = (tamper: (data: Data) => Data = (d) => d) => wire((from, d) => (from === 0 ? tamper(d) : d));

// 傳送檔案用的通道：有序、可靠，文字訊息是 JSON，二進位訊息是檔案的內容。純邏輯，有單元測試。
//
// 傳輸的流程（transfer.ts）只認這個介面，不管底下是什麼連線。面對面傳送接 WebRTC 的資料通道
// （src/ui/nearby.ts 的 rtcChannel），之後的遠端傳送接 WebSocket 轉送（anoni-net/gears#104）。

export type Data = string | ArrayBuffer;

export interface Channel {
  send(data: Data): void;
  // 送出端的緩衝太多時等它降下來，通道關掉就 reject
  drained(): Promise<void>;
  // 依序取出對方送來的下一則，通道關掉、佇列也取完了就 reject
  next(): Promise<Data>;
  close(): void;
}

// 對方送來的訊息排成佇列。要在拿到通道的當下就建好，對方早一步送來的訊息才不會漏掉
export class Inbox {
  private queue: Data[] = [];
  private waiting: { resolve: (v: Data) => void; reject: (e: Error) => void }[] = [];
  private closed: Error | null = null;

  push(item: Data) {
    const w = this.waiting.shift();
    if (w) w.resolve(item);
    else this.queue.push(item);
  }

  // 通道關掉之後，已經排進來的訊息仍然取得到，取完才 reject
  end(error = new Error("closed")) {
    if (this.closed) return;
    this.closed = error;
    for (const w of this.waiting.splice(0)) w.reject(error);
  }

  next(): Promise<Data> {
    const item = this.queue.shift();
    if (item !== undefined) return Promise.resolve(item);
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
}

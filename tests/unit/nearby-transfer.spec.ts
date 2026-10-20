import { expect, test } from "@playwright/test";
import { type Channel, type Data, Inbox } from "../../src/tools/nearby/channel.ts";
import { CHUNK, MAX_TOTAL, parseMessage } from "../../src/tools/nearby/protocol.ts";
import { TooLargeError, receiveFiles, sendFiles } from "../../src/tools/nearby/transfer.ts";

// 記憶體裡的一對通道，送出的訊息複製一份、在下一個 microtask 交給對方，跟真的通道一樣不同步
function pair(tamper: (data: Data) => Data = (d) => d): [Channel, Channel] {
  const boxes = [new Inbox(), new Inbox()] as const;
  const end = (mine: Inbox, theirs: Inbox, outgoing: (d: Data) => Data): Channel => ({
    send(data) {
      const copy = outgoing(typeof data === "string" ? data : data.slice(0));
      queueMicrotask(() => theirs.push(copy));
    },
    drained: () => Promise.resolve(),
    next: () => mine.next(),
    close() {
      mine.end();
      theirs.end();
    },
  });
  return [end(boxes[0], boxes[1], tamper), end(boxes[1], boxes[0], (d) => d)];
}

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

test("檔案依序傳完，名稱、類型與內容都相同", async () => {
  const [a, b] = pair();
  const big = bytes(CHUNK * 2 + 5);
  const files = [
    { name: "gears-1.jpg", blob: new Blob([big], { type: "image/jpeg" }) },
    { name: "gears-2.txt", blob: new Blob([], { type: "text/plain" }) },
  ];
  const sentProgress: number[] = [];
  const sending = sendFiles(a, files, (sent) => sentProgress.push(sent));
  const incoming = await receiveFiles(b);
  expect(incoming.files.map((f) => [f.name, f.size, f.type])).toEqual([
    ["gears-1.jpg", big.length, "image/jpeg"],
    ["gears-2.txt", 0, "text/plain"],
  ]);
  const received = await incoming.accept(() => {});
  expect(await sending).toEqual({ declined: false, ok: [true, true] });
  expect(received.ok).toEqual([true, true]);
  expect(received.files.map((f) => f.name)).toEqual(["gears-1.jpg", "gears-2.txt"]);
  expect(new Uint8Array(await received.files[0]!.arrayBuffer())).toEqual(big);
  expect(received.files[1]!.size).toBe(0);
  expect(sentProgress).toEqual([CHUNK, CHUNK * 2, big.length]);
});

test("接收端拒絕時不傳任何內容", async () => {
  const [a, b] = pair();
  const sending = sendFiles(a, [{ name: "gears-1.pdf", blob: new Blob([bytes(10)]) }], () => {});
  (await receiveFiles(b)).decline();
  expect(await sending).toEqual({ declined: true });
});

test("內容在途中被改掉時，SHA-256 對不上的檔案不交出去", async () => {
  const [a, b] = pair((d) => {
    if (typeof d === "string") return d;
    const copy = new Uint8Array(d);
    copy[0]! ^= 1;
    return copy.buffer;
  });
  const sending = sendFiles(a, [{ name: "gears-1.bin", blob: new Blob([bytes(100)]) }], () => {});
  const received = await (await receiveFiles(b)).accept(() => {});
  expect(received).toEqual({ files: [], ok: [false] });
  expect(await sending).toEqual({ declined: false, ok: [false] });
});

test("合計超過上限時回絕，不配置記憶體", async () => {
  const [a, b] = pair();
  a.send(JSON.stringify({ t: "files", files: [{ name: "big.bin", size: MAX_TOTAL + 1, type: "", sha256: "0".repeat(64) }] }));
  const incoming = await receiveFiles(b);
  await expect(incoming.accept(() => {})).rejects.toBeInstanceOf(TooLargeError);
  expect(parseMessage((await a.next()) as string)).toEqual({ t: "decline" });
});

test("對方送來不合格的訊息時停下來", async () => {
  const [a, b] = pair();
  a.send(new ArrayBuffer(4));
  await expect(receiveFiles(b)).rejects.toThrow("bad-message");
  a.send('{"t":"accept"}');
  await expect(receiveFiles(b)).rejects.toThrow("bad-message");
});

test("通道中途關掉時不會一直等下去", async () => {
  const [a, b] = pair();
  a.send(JSON.stringify({ t: "files", files: [{ name: "a.bin", size: 10, type: "", sha256: "0".repeat(64) }] }));
  const incoming = await receiveFiles(b);
  const accepting = incoming.accept(() => {});
  a.close();
  await expect(accepting).rejects.toThrow("closed");
});

test("佇列：先到的訊息留著，關掉之後已經排進來的仍取得到，取完才失敗", async () => {
  const box = new Inbox();
  box.push("one");
  const waiting = box.next();
  const second = box.next();
  box.push("two");
  box.push("three");
  box.end();
  expect(await waiting).toBe("one");
  expect(await second).toBe("two");
  expect(await box.next()).toBe("three");
  await expect(box.next()).rejects.toThrow("closed");
});

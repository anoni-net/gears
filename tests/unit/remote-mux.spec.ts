import { expect, test } from "@playwright/test";
import { receiveFiles, sendFiles } from "../../src/tools/nearby/transfer.ts";
import { split } from "../../src/tools/remote/mux.ts";
import { wire } from "../helpers/channel-pair.ts";

test("檔案與文字訊息分在兩條，傳檔案時夾著的訊息不會混進檔案那一條", async () => {
  const [x, y] = wire();
  const a = split(x);
  const b = split(y);
  const data = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7) & 255);
  const sending = sendFiles(a.files, [{ name: "gears-1.bin", blob: new Blob([data]) }], () => {});
  a.messages.send("先說一聲");
  const incoming = await receiveFiles(b.files);
  b.messages.send("收到，正在接收");
  const accepting = incoming.accept(() => {});
  a.messages.send("f 開頭的訊息也不會混淆");
  const received = await accepting;
  expect(await sending).toEqual({ declined: false, ok: [true] });
  expect(new Uint8Array(await received.files[0]!.arrayBuffer())).toEqual(data);
  expect(await b.messages.next()).toBe("先說一聲");
  expect(await b.messages.next()).toBe("f 開頭的訊息也不會混淆");
  expect(await a.messages.next()).toBe("收到，正在接收");
});

test("沒有標記的訊息讓兩條一起結束", async () => {
  const [x, y] = wire();
  const b = split(y);
  x.send("x沒有這種標記");
  await expect(b.files.next()).rejects.toThrow("bad-message");
  await expect(b.messages.next()).rejects.toThrow("bad-message");
});

test("底下的通道關掉時兩條一起結束", async () => {
  const [x, y] = wire();
  const a = split(x);
  const b = split(y);
  const waiting = b.messages.next();
  a.files.close();
  await expect(waiting).rejects.toThrow("closed");
  await expect(b.files.next()).rejects.toThrow("closed");
});

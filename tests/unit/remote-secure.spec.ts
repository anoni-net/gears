import { expect, test } from "@playwright/test";
import { startRelay } from "../../server/relay.ts";
import type { Channel, Data } from "../../src/tools/nearby/channel.ts";
import { receiveFiles, sendFiles } from "../../src/tools/nearby/transfer.ts";
import { RelayLink } from "../../src/tools/remote/relay-client.ts";
import { LINK_KEY_BYTES, type Role, SecureError, decodeKey, encodeKey, newLinkKey, secure } from "../../src/tools/remote/secure.ts";
import { wire } from "../helpers/channel-pair.ts";

const both = (a: Channel, b: Channel, keyA: Uint8Array, keyB = keyA) => Promise.all([secure(a, keyA, "opener"), secure(b, keyB, "joiner")]);

const text = (d: Data) => (typeof d === "string" ? d : new TextDecoder().decode(d));

test("連結金鑰編成 43 個字元，解回來相同，長度或字元不對就是 null", () => {
  const key = newLinkKey();
  expect(key.length).toBe(LINK_KEY_BYTES);
  const encoded = encodeKey(key);
  expect(encoded).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(decodeKey(encoded)).toEqual(key);
  expect(decodeKey(encoded.slice(1))).toBeNull();
  expect(decodeKey(encoded.slice(0, -1) + "!")).toBeNull();
  expect(encodeKey(newLinkKey())).not.toBe(encoded);
});

test("同一把連結金鑰：兩端的確認碼相同，文字與二進位都送得到", async () => {
  const key = newLinkKey();
  const [a, b] = await both(...wire(), key);
  expect(a.confirm).toMatch(/^\d{3} \d{3}$/);
  expect(a.confirm).toBe(b.confirm);
  a.channel.send("哈囉");
  b.channel.send(Uint8Array.from([9, 8, 7]).buffer);
  expect(await b.channel.next()).toBe("哈囉");
  expect(new Uint8Array((await a.channel.next()) as ArrayBuffer)).toEqual(Uint8Array.from([9, 8, 7]));
});

test("途中看得到的只有公鑰與密文", async () => {
  const seen: Data[] = [];
  const [a, b] = await both(...wire((_, d) => (seen.push(d), d)), newLinkKey());
  const secret = "身分證 A123456789、電話 0912-345-678";
  const sending = sendFiles(a.channel, [{ name: "名單.csv", blob: new Blob([secret.repeat(50)]) }], () => {});
  await (await receiveFiles(b.channel)).accept(() => {});
  await sending;
  // 明文的只有交換公鑰的 hello
  const plain = seen.filter((d) => typeof d === "string");
  expect(plain).toHaveLength(2);
  for (const m of plain) expect(Object.keys(JSON.parse(m as string)).sort()).toEqual(["e", "key", "t", "v"]);
  const all = seen.map(text).join("\n");
  for (const leak of ["A123456789", "0912-345-678", "名單.csv", '"t":"files"', "sha256"]) expect(all).not.toContain(leak);
});

test("連結金鑰不對時兩端都在 ready 停下來", async () => {
  const [a, b] = wire();
  const settled = await Promise.allSettled([secure(a, newLinkKey(), "opener"), secure(b, newLinkKey(), "joiner")]);
  for (const r of settled) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "wrong-key" });
});

test("內容被改、被丟掉或重送時，收到的一端停下來", async () => {
  // 第一端送出的二進位：第 1 則是 ready，第 2 則是 one，第 3 則是 two
  for (const attack of ["flip", "drop", "replay"] as const) {
    let count = 0;
    let last: ArrayBuffer | null = null;
    const [x, y] = wire((from, d) => {
      if (from !== 0 || typeof d === "string") return d;
      count++;
      if (count === 2) {
        if (attack === "flip") {
          const u = new Uint8Array(d);
          u[u.length - 1]! ^= 1;
          return u.buffer;
        }
        if (attack === "drop") return null;
      }
      if (count === 3 && attack === "replay" && last) return last;
      last = d.slice(0);
      return d;
    });
    const [a, b] = await both(x, y, newLinkKey());
    a.channel.send("one");
    a.channel.send("two");
    if (attack === "replay") {
      expect(await b.channel.next()).toBe("one");
    }
    await expect(b.channel.next(), attack).rejects.toMatchObject({ code: "tampered" });
  }
});

test("知道連結金鑰的人在中間轉手，兩端的確認碼對不上", async () => {
  const key = newLinkKey();
  // 中間人跟兩端各握手一次，再把內容轉過去
  const [a, m1] = wire();
  const [m2, b] = wire();
  const [sa, sm1, sm2, sb] = await Promise.all([secure(a, key, "opener"), secure(m1, key, "joiner"), secure(m2, key, "opener"), secure(b, key, "joiner")]);
  expect(sa.confirm).toBe(sm1.confirm);
  expect(sb.confirm).toBe(sm2.confirm);
  expect(sa.confirm).not.toBe(sb.confirm);
});

test("不知道連結金鑰的中間人換掉公鑰，握手失敗", async () => {
  const [a, b] = wire((_, d) => {
    if (typeof d !== "string") return d;
    const m = JSON.parse(d);
    return JSON.stringify({ ...m, key: encodeKey(newLinkKey()) });
  });
  const key = newLinkKey();
  const settled = await Promise.allSettled([secure(a, key, "opener"), secure(b, key, "joiner")]);
  for (const r of settled) expect(r.status).toBe("rejected");
});

test("對方送來的不是合格的 hello", async () => {
  for (const [hello, code] of [
    ["not json", "bad-hello"],
    ['{"t":"hello","v":2,"key":"x"}', "version"],
    ['{"t":"hello","v":1,"e":0,"key":"short"}', "bad-hello"],
    [JSON.stringify({ t: "hello", v: 1, e: 0, key: encodeKey(new Uint8Array(32)) }), "bad-hello"],
    [JSON.stringify({ t: "hello", v: 1, e: 3, key: encodeKey(newLinkKey()) }), "bad-hello"],
  ] as const) {
    const [a, b] = wire();
    b.send(hello);
    await expect(secure(a, newLinkKey(), "opener" as Role), hello).rejects.toMatchObject({ code });
  }
  const [a, b] = wire();
  b.send(new ArrayBuffer(3));
  await expect(secure(a, newLinkKey(), "opener")).rejects.toBeInstanceOf(SecureError);
});

test("經過轉送服務加密傳完一份檔案，轉送服務轉的都是密文", async () => {
  const relay = await startRelay({ port: 0 });
  try {
    const key = newLinkKey();
    const opener = await RelayLink.open(relay.url);
    const joiner = await RelayLink.join(relay.url, opener.room);
    await opener.paired;
    const [a, b] = await both(opener, joiner, key);
    expect(a.confirm).toBe(b.confirm);
    const content = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 11) & 255);
    const sending = sendFiles(a.channel, [{ name: "gears-1.bin", blob: new Blob([content]) }], () => {});
    const received = await (await receiveFiles(b.channel)).accept(() => {});
    expect(await sending).toEqual({ declined: false, ok: [true] });
    expect(new Uint8Array(await received.files[0]!.arrayBuffer())).toEqual(content);
    a.channel.close();
  } finally {
    await relay.close();
  }
});

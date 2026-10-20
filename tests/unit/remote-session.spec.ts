import { expect, test } from "@playwright/test";
import { type Relay, type RelayOptions, startRelay } from "../../server/relay.ts";
import { CHUNK } from "../../src/tools/nearby/protocol.ts";
import { receiveFiles, sendFiles } from "../../src/tools/nearby/transfer.ts";
import { RelayLink } from "../../src/tools/remote/relay-client.ts";
import { newLinkKey } from "../../src/tools/remote/secure.ts";
import { RemoteSession, type SessionOptions, type SessionState, WINDOW } from "../../src/tools/remote/session.ts";

async function withRelay(options: Partial<RelayOptions>, run: (relay: Relay) => Promise<void>) {
  const relay = await startRelay({ port: 0, pingMs: 60_000, ...options });
  try {
    await run(relay);
  } finally {
    await relay.close();
  }
}

async function sessions(relay: Relay, options?: SessionOptions) {
  const key = newLinkKey();
  const opener = await RelayLink.open(relay.url);
  const joiner = await RelayLink.join(relay.url, opener.room);
  const a = new RemoteSession(opener, key, "opener", options);
  const b = new RemoteSession(joiner, key, "joiner", options);
  const [ca, cb] = await Promise.all([a.confirm, b.confirm]);
  return { a, b, opener, joiner, ca, cb };
}

// 模擬網路中斷或手機切到背景：不送 1000，直接斷
const drop = (link: RelayLink) => (link as unknown as { ws: WebSocket | null }).ws?.close(4000);

const content = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 29 + (i >> 9)) & 255);

async function transfer(a: RemoteSession, b: RemoteSession, data: Uint8Array<ArrayBuffer>, hooks: { sent?: (n: number) => void; received?: (n: number) => void } = {}) {
  const sending = sendFiles(a, [{ name: "gears-1.bin", blob: new Blob([data]) }], (n) => hooks.sent?.(n));
  const incoming = await receiveFiles(b);
  const received = await incoming.accept((n) => hooks.received?.(n));
  const result = await sending;
  return { result, file: new Uint8Array(await received.files[0]!.arrayBuffer()), ok: received.ok };
}

test("開房之後馬上建立 session，等對方加入才握手", async () => {
  await withRelay({}, async (relay) => {
    const key = newLinkKey();
    const opener = await RelayLink.open(relay.url);
    const a = new RemoteSession(opener, key, "opener");
    await new Promise((r) => setTimeout(r, 100));
    const joiner = await RelayLink.join(relay.url, opener.room);
    const b = new RemoteSession(joiner, key, "joiner");
    expect(await a.confirm).toBe(await b.confirm);
    a.send("hi");
    expect(await b.next()).toBe("hi");
    a.close();
  });
});

test("開房之後沒人加入，房間過期時 session 跟著結束", async () => {
  await withRelay({ waitMs: 150 }, async (relay) => {
    const a = new RemoteSession(await RelayLink.open(relay.url), newLinkKey(), "opener");
    await expect(a.confirm).rejects.toMatchObject({ code: "gone" });
  });
});

test("沒有斷線：確認碼相同，檔案完整", async () => {
  await withRelay({}, async (relay) => {
    const { a, b, ca, cb } = await sessions(relay);
    expect(ca).toBe(cb);
    const data = content(4 * 1024 * 1024);
    const { result, file } = await transfer(a, b, data);
    expect(result).toEqual({ declined: false, ok: [true] });
    expect(file).toEqual(data);
    a.close();
  });
});

test("送出端傳到一半斷線，自動接回來，從斷掉的地方接著傳", async () => {
  await withRelay({}, async (relay) => {
    const { a, b, opener } = await sessions(relay);
    const seen: SessionState[] = [];
    a.onState((s) => seen.push(s));
    const data = content(6 * 1024 * 1024);
    let dropped = false;
    const { result, file } = await transfer(a, b, data, {
      sent: (n) => {
        if (!dropped && n > 2 * 1024 * 1024) {
          dropped = true;
          drop(opener);
        }
      },
    });
    expect(dropped).toBe(true);
    expect(seen).toContain("reconnecting");
    expect(seen.at(-1)).toBe("connected");
    expect(result).toEqual({ declined: false, ok: [true] });
    expect(file).toEqual(data);
    a.close();
  });
});

test("接收端傳到一半斷線，接回來之後補齊", async () => {
  await withRelay({}, async (relay) => {
    const { a, b, joiner } = await sessions(relay);
    const away: SessionState[] = [];
    a.onState((s) => away.push(s));
    const data = content(6 * 1024 * 1024);
    let dropped = false;
    const { result, file } = await transfer(a, b, data, {
      received: (n) => {
        if (!dropped && n > 3 * 1024 * 1024) {
          dropped = true;
          drop(joiner);
        }
      },
    });
    expect(dropped).toBe(true);
    expect(away).toContain("peer-away");
    expect(result).toEqual({ declined: false, ok: [true] });
    expect(file).toEqual(data);
    a.close();
  });
});

test("兩端輪流斷好幾次，檔案仍然完整", async () => {
  await withRelay({}, async (relay) => {
    const { a, b, opener, joiner } = await sessions(relay);
    const data = content(8 * 1024 * 1024);
    const marks = [1, 3, 5, 6.5].map((m) => m * 1024 * 1024);
    let next = 0;
    const { result, file } = await transfer(a, b, data, {
      received: (n) => {
        if (next < marks.length && n > marks[next]!) drop(next++ % 2 === 0 ? opener : joiner);
      },
    });
    expect(next).toBe(marks.length);
    expect(result).toEqual({ declined: false, ok: [true] });
    expect(file).toEqual(data);
    a.close();
  });
});

test("伺服器還沒發現舊連線斷了，讀者已經接回來", async () => {
  await withRelay({}, async (relay) => {
    const { a, b, opener } = await sessions(relay);
    const data = content(5 * 1024 * 1024);
    let resumed = false;
    const { result, file } = await transfer(a, b, data, {
      sent: (n) => {
        if (!resumed && n > 2 * 1024 * 1024) {
          resumed = true;
          void opener.resume();
        }
      },
    });
    expect(resumed).toBe(true);
    expect(result).toEqual({ declined: false, ok: [true] });
    expect(file).toEqual(data);
    a.close();
  });
});

test("還沒收到 ack 的量不超過 WINDOW", async () => {
  await withRelay({}, async (relay) => {
    const { a, b } = await sessions(relay);
    let most = 0;
    const pending = () => (a as unknown as { pendingBytes: number }).pendingBytes;
    const { result } = await transfer(a, b, content(12 * 1024 * 1024), { sent: () => (most = Math.max(most, pending())) });
    expect(result).toEqual({ declined: false, ok: [true] });
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(WINDOW + 2 * (CHUNK + 64));
    a.close();
  });
});

test("對方結束時另一端收到 gone，不會一直等", async () => {
  await withRelay({}, async (relay) => {
    const { a, b } = await sessions(relay);
    const waiting = b.next();
    a.close();
    await expect(waiting).rejects.toMatchObject({ code: "gone" });
    expect(() => a.send("x")).toThrow("closed");
  });
});

test("斷線太久，房間已經關了，兩端都結束", async () => {
  await withRelay({ graceMs: 100 }, async (relay) => {
    const { a, b, opener } = await sessions(relay, { retry: [400] });
    const waitingA = a.next();
    const waitingB = b.next();
    drop(opener);
    await expect(waitingB).rejects.toMatchObject({ code: "gone" });
    await expect(waitingA).rejects.toMatchObject({ code: "no-room" });
  });
});

test("連結金鑰不對，兩端都結束在握手", async () => {
  await withRelay({}, async (relay) => {
    const opener = await RelayLink.open(relay.url);
    const joiner = await RelayLink.join(relay.url, opener.room);
    const a = new RemoteSession(opener, newLinkKey(), "opener");
    const b = new RemoteSession(joiner, newLinkKey(), "joiner");
    const settled = await Promise.allSettled([a.confirm, b.confirm]);
    expect(settled.some((r) => r.status === "rejected" && (r.reason as { code: string }).code === "wrong-key")).toBe(true);
    for (const r of settled) expect(r.status).toBe("rejected");
  });
});

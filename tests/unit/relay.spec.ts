import { expect, test } from "@playwright/test";
import { type Relay, type RelayOptions, startRelay } from "../../server/relay.ts";
import { CHUNK } from "../../src/tools/nearby/protocol.ts";
import { receiveFiles, sendFiles } from "../../src/tools/nearby/transfer.ts";
import { MAX_FRAME, RELAY_VERSION, frame, isId, parseClientControl, parseServerControl, randomId, unframe } from "../../src/tools/remote/relay.ts";
import { type LinkState, RelayError, RelayLink } from "../../src/tools/remote/relay-client.ts";

// ── 協定 ──────────────────────────────────────────────────────────────────

test("房間代碼與 token 是 22 個字元的 base64url，每次都不同", () => {
  const ids = new Set(Array.from({ length: 200 }, randomId));
  expect(ids.size).toBe(200);
  for (const id of ids) expect(isId(id)).toBe(true);
  expect(isId("short")).toBe(false);
  expect(isId("a".repeat(21) + "/")).toBe(false);
});

test("控制訊息：合格的讀出來，版本不同另外標出，其他一律擋下", () => {
  const room = randomId();
  const token = randomId();
  expect(parseClientControl(JSON.stringify({ t: "open", v: RELAY_VERSION, extra: 1 }))).toEqual({ t: "open", v: RELAY_VERSION });
  expect(parseClientControl(JSON.stringify({ t: "resume", v: RELAY_VERSION, room, token }))).toEqual({ t: "resume", v: RELAY_VERSION, room, token });
  expect(() => parseClientControl(JSON.stringify({ t: "open", v: 99 }))).toThrow("version");
  for (const bad of ["x", "[]", '{"t":"join","v":1,"room":"nope"}', JSON.stringify({ t: "resume", v: 1, room }), '{"t":"hello","v":1}'])
    expect(() => parseClientControl(bad), bad).toThrow("bad-message");

  expect(parseServerControl(JSON.stringify({ t: "paired" }))).toEqual({ t: "paired" });
  expect(parseServerControl(JSON.stringify({ t: "resumed", paired: true, epoch: 2 }))).toEqual({ t: "resumed", paired: true, epoch: 2 });
  expect(parseServerControl(JSON.stringify({ t: "error", code: "no-room" }))).toEqual({ t: "error", code: "no-room" });
  for (const bad of ['{"t":"error","code":"boom"}', '{"t":"resumed","paired":true}', '{"t":"back","epoch":0}', '{"t":"room","room":"x","token":"y"}'])
    expect(() => parseServerControl(bad), bad).toThrow("bad-message");
});

test("框：文字與二進位分得開，空的或不認得的種類擋下", () => {
  expect(unframe(frame('{"t":"accept"}'))).toBe('{"t":"accept"}');
  expect(unframe(frame("中文"))).toBe("中文");
  const bytes = Uint8Array.from([0, 1, 2, 255]);
  expect(new Uint8Array(unframe(frame(bytes.buffer)) as ArrayBuffer)).toEqual(bytes);
  expect(() => unframe(new Uint8Array())).toThrow("bad-message");
  expect(() => unframe(Uint8Array.from([7, 1]))).toThrow("bad-message");
  expect(() => unframe(Uint8Array.from([0, 0xff]))).toThrow();
});

// ── 轉送服務 ──────────────────────────────────────────────────────────────

const FAST: Partial<RelayOptions> = { port: 0, waitMs: 2000, graceMs: 400, helloMs: 300, pingMs: 60_000 };

async function withRelay(options: Partial<RelayOptions>, run: (relay: Relay) => Promise<void>) {
  const relay = await startRelay({ ...FAST, ...options });
  try {
    await run(relay);
  } finally {
    await relay.close();
  }
}

const until = async (check: () => boolean, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const states = (link: RelayLink) => {
  const seen: LinkState[] = [];
  link.onState((s) => seen.push(s));
  return seen;
};

// 直接操作 WebSocket，不經過 RelayLink，測伺服器擋不合格的連線
function raw(url: string) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const messages: unknown[] = [];
  ws.addEventListener("message", (e) => messages.push(e.data));
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  const opened = new Promise<void>((resolve) => ws.addEventListener("open", () => resolve()));
  return { ws, messages, closed, opened };
}

test("開房、加入、配對，兩端的訊息原樣轉給對方", async () => {
  await withRelay({}, async (relay) => {
    const a = await RelayLink.open(relay.url);
    expect(isId(a.room) && isId(a.token)).toBe(true);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    await b.paired;
    expect(b.token).not.toBe(a.token);
    a.send("hello");
    b.send(Uint8Array.from([1, 2, 3]).buffer);
    expect(await b.next()).toBe("hello");
    expect(new Uint8Array((await a.next()) as ArrayBuffer)).toEqual(Uint8Array.from([1, 2, 3]));
    a.close();
    await expect(b.next()).rejects.toThrow("gone");
    await until(() => relay.rooms() === 0);
  });
});

test("面對面傳送的傳輸流程直接經過轉送", async () => {
  await withRelay({}, async (relay) => {
    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    const big = Uint8Array.from({ length: CHUNK * 3 + 7 }, (_, i) => (i * 7) & 255);
    const sending = sendFiles(a, [{ name: "gears-1.bin", blob: new Blob([big]) }], () => {});
    const incoming = await receiveFiles(b);
    const received = await incoming.accept(() => {});
    expect(await sending).toEqual({ declined: false, ok: [true] });
    expect(new Uint8Array(await received.files[0]!.arrayBuffer())).toEqual(big);
    a.close();
  });
});

test("大檔案：送出端比轉送快時等緩衝降下來，內容完整", async () => {
  await withRelay({}, async (relay) => {
    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    const big = Uint8Array.from({ length: 24 * 1024 * 1024 }, (_, i) => (i * 13) & 255);
    const sending = sendFiles(a, [{ name: "gears-1.bin", blob: new Blob([big]) }], () => {});
    const received = await (await receiveFiles(b)).accept(() => {});
    expect(await sending).toEqual({ declined: false, ok: [true] });
    expect(received.files[0]!.size).toBe(big.length);
    a.close();
  });
});

test("房間不存在、已經配對過時加入失敗", async () => {
  await withRelay({}, async (relay) => {
    await expect(RelayLink.join(relay.url, randomId())).rejects.toMatchObject({ code: "no-room" });
    const a = await RelayLink.open(relay.url);
    await RelayLink.join(relay.url, a.room);
    await expect(RelayLink.join(relay.url, a.room)).rejects.toMatchObject({ code: "room-full" });
  });
});

test("斷線之後用同一個房間接回來，對方收到 away 與 back", async () => {
  await withRelay({}, async (relay) => {
    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    const seenA = states(a);
    const seenB = states(b);
    // 模擬網路中斷：不送 1000，直接斷
    (b as unknown as { ws: WebSocket }).ws.close(4000);
    await until(() => seenA.includes("away") && seenB.includes("disconnected"));
    await b.resume();
    await until(() => seenA.includes("back"));
    a.send("again");
    expect(await b.next()).toBe("again");
    expect(relay.rooms()).toBe(1);
    a.close();
  });
});

test("斷線太久沒接回來，房間關閉，對方收到 gone", async () => {
  await withRelay({ graceMs: 150 }, async (relay) => {
    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    (b as unknown as { ws: WebSocket }).ws.close(4000);
    await expect(a.next()).rejects.toThrow("gone");
    expect(relay.rooms()).toBe(0);
    await expect(b.resume()).rejects.toMatchObject({ code: "no-room" });
  });
});

test("開房的一端在對方加入前斷線，接回來時知道已經配對", async () => {
  await withRelay({}, async (relay) => {
    const a = await RelayLink.open(relay.url);
    (a as unknown as { ws: WebSocket }).ws.close(4000);
    await until(() => !(a as unknown as { ws: WebSocket | null }).ws);
    const b = await RelayLink.join(relay.url, a.room);
    const seenB = states(b);
    await a.resume();
    await a.paired;
    await until(() => seenB.includes("back"));
    b.send("hi");
    expect(await a.next()).toBe("hi");
    a.close();
  });
});

test("token 不對不能接回來", async () => {
  await withRelay({}, async (relay) => {
    const a = await RelayLink.open(relay.url);
    a.token = randomId();
    await expect(a.resume()).rejects.toMatchObject({ code: "no-room" });
  });
});

test("沒人加入的房間等太久就關閉", async () => {
  await withRelay({ waitMs: 150 }, async (relay) => {
    const a = await RelayLink.open(relay.url);
    await expect(a.paired).rejects.toThrow("gone");
    expect(relay.rooms()).toBe(0);
  });
});

test("開房太頻繁、同時開著的房間太多時拒絕", async () => {
  await withRelay({ opensPerClient: 2, maxRooms: 100 }, async (relay) => {
    await RelayLink.open(relay.url);
    await RelayLink.open(relay.url);
    await expect(RelayLink.open(relay.url)).rejects.toMatchObject({ code: "rate-limited" });
  });
  await withRelay({ maxRooms: 1 }, async (relay) => {
    await RelayLink.open(relay.url);
    await expect(RelayLink.open(relay.url)).rejects.toMatchObject({ code: "busy" });
  });
});

test("一個房間轉送的量超過上限，兩端都收到 quota 並關閉", async () => {
  await withRelay({ roomBytes: 1000 }, async (relay) => {
    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    a.send(new Uint8Array(600).buffer);
    await b.next();
    a.send(new Uint8Array(600).buffer);
    await expect(b.next()).rejects.toMatchObject({ code: "quota" });
    await expect(a.next()).rejects.toMatchObject({ code: "quota" });
    expect(relay.rooms()).toBe(0);
  });
});

test("協定版本不同、第一則不是控制訊息、太久沒說話、太大的訊息都斷線", async () => {
  await withRelay({}, async (relay) => {
    const old = raw(relay.url);
    await old.opened;
    old.ws.send(JSON.stringify({ t: "open", v: RELAY_VERSION + 1 }));
    expect(await old.closed).toBe(1008);
    expect(parseServerControl(old.messages[0] as string)).toEqual({ t: "error", code: "version" });

    const binary = raw(relay.url);
    await binary.opened;
    binary.ws.send(new Uint8Array(4));
    expect(await binary.closed).toBe(1008);

    const silent = raw(relay.url);
    expect(await silent.closed).toBe(1008);

    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    await a.paired;
    a.send(new Uint8Array(MAX_FRAME + 10).buffer);
    await expect(b.next()).rejects.toThrow();
    expect(relay.rooms()).toBe(0);
  });
});

test("配對之後送文字的一端被斷線，房間關閉", async () => {
  await withRelay({}, async (relay) => {
    const a = raw(relay.url);
    await a.opened;
    a.ws.send(JSON.stringify({ t: "open", v: RELAY_VERSION }));
    await until(() => a.messages.length === 1);
    const { room } = parseServerControl(a.messages[0] as string) as { room: string };
    const b = await RelayLink.join(relay.url, room);
    a.ws.send("plain text");
    expect(await a.closed).toBe(1008);
    await expect(b.next()).rejects.toThrow("gone");
  });
});

test("RelayError 帶著原因", () => {
  const e = new RelayError("busy");
  expect(e.code).toBe("busy");
  expect(e.message).toBe("busy");
});

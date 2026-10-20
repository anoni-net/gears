import { expect, test } from "@playwright/test";
import { startRelay } from "../../server/relay.ts";
import { filterIce } from "../../server/turn.ts";
import { Signals, connectDirect, parseSignal } from "../../src/tools/remote/direct.ts";
import { NO_ICE, parseServerControl } from "../../src/tools/remote/relay.ts";
import { RelayLink } from "../../src/tools/remote/relay-client.ts";
import { wire } from "../helpers/channel-pair.ts";

test("Cloudflare 回傳的伺服器只留 TURN，拿掉 STUN 與 port 53", () => {
  const servers = filterIce([
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp", "turn:turn.cloudflare.com:53"],
      username: "u",
      credential: "c",
    },
    { urls: "turn:no-credential.example:3478" },
  ]);
  expect(servers).toEqual([{ urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u", credential: "c" }]);
  expect(filterIce(undefined)).toEqual([]);
});

test("ice 控制訊息：只收 turn: 與 turns:，policy 要認得", () => {
  const ok = { t: "ice", policy: "relay", servers: [{ urls: ["turns:turn.example:443?transport=tcp"], username: "u", credential: "c" }] };
  expect(parseServerControl(JSON.stringify(ok))).toEqual(ok);
  expect(parseServerControl(JSON.stringify({ t: "ice", policy: "off", servers: [] }))).toEqual({ t: "ice", policy: "off", servers: [] });
  for (const bad of [
    { ...ok, policy: "any" },
    { ...ok, servers: [{ urls: ["stun:stun.example:3478"] }] },
    { ...ok, servers: [{ urls: ["https://evil.example/"] }] },
    { ...ok, servers: "x" },
  ])
    expect(() => parseServerControl(JSON.stringify(bad)), JSON.stringify(bad)).toThrow("bad-message");
});

test("信令：合格的讀出來，不合格的丟掉", () => {
  expect(parseSignal('{"t":"offer","sdp":"v=0"}')).toEqual({ t: "offer", sdp: "v=0" });
  expect(parseSignal('{"t":"via","rtc":true}')).toEqual({ t: "via", rtc: true, retry: false });
  expect(parseSignal('{"t":"cand","c":null}')).toEqual({ t: "cand", c: null });
  expect(parseSignal('{"t":"cand","c":{"candidate":"candidate:1 1 udp 1 192.0.2.1 9 typ relay","sdpMid":"0","sdpMLineIndex":0}}')).toEqual({
    t: "cand",
    c: { candidate: "candidate:1 1 udp 1 192.0.2.1 9 typ relay", sdpMid: "0", sdpMLineIndex: 0 },
  });
  for (const bad of ["x", '{"t":"via"}', '{"t":"offer"}', '{"t":"hello"}', '{"t":"cand","c":{}}']) expect(parseSignal(bad), bad).toBeNull();
});

test("信令依序交給等著的人，候選另外交出去，逾時是 null", async () => {
  const [a, b] = wire();
  const theirs = new Signals(b);
  const cands: unknown[] = [];
  new Signals(a).send({ t: "cand", c: null });
  a.send(JSON.stringify({ t: "via", rtc: false }));
  a.send(JSON.stringify({ t: "offer", sdp: "v=0" }));
  a.send("不是信令");
  expect(await theirs.next((s) => s.t === "offer", 1000)).toEqual({ t: "offer", sdp: "v=0" });
  expect(await theirs.next((s) => s.t === "via", 1000)).toEqual({ t: "via", rtc: false, retry: false });
  theirs.onCandidate((c) => cands.push(c));
  expect(cands).toEqual([null]);
  expect(await theirs.next((s) => s.t === "answer", 50)).toBeNull();
});

test("沒有 WebRTC 或伺服器沒有發 TURN 時不試，兩端都回傳 null", async () => {
  const [a, b] = wire();
  const [x, y] = await Promise.all([connectDirect(new Signals(a), NO_ICE, "opener", 500), connectDirect(new Signals(b), NO_ICE, "joiner", 500)]);
  expect(x).toBeNull();
  expect(y).toBeNull();
});

test("舊版的頁面沒有聲明認得 ice，伺服器不發，第一則就是轉送的內容", async () => {
  const relay = await startRelay({ port: 0, pingMs: 60_000, ice: async () => ({ policy: "relay", servers: [] }) });
  try {
    const open = (hello: object) => {
      const ws = new WebSocket(relay.url);
      ws.binaryType = "arraybuffer";
      const got: unknown[] = [];
      ws.addEventListener("message", (e) => got.push(e.data));
      ws.addEventListener("open", () => ws.send(JSON.stringify(hello)));
      return { ws, got };
    };
    const a = open({ t: "open", v: 1 });
    await expect.poll(() => a.got.length).toBe(1);
    const room = JSON.parse(a.got[0] as string).room;
    const b = open({ t: "join", v: 1, room });
    await expect.poll(() => b.got.length).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    a.ws.send(Uint8Array.from([7]));
    await expect.poll(() => b.got.length).toBe(2);
    expect(typeof b.got[1]).not.toBe("string");
    expect(a.got.map((m) => (typeof m === "string" ? JSON.parse(m).t : "bin"))).toEqual(["room", "paired"]);
    a.ws.close(1000);
  } finally {
    await relay.close();
  }
});

test("轉送服務在配對之後發 ice 給兩端，沒有設定時是 off", async () => {
  const servers = [{ urls: ["turns:turn.example:443?transport=tcp"], username: "u", credential: "c" }];
  const relay = await startRelay({ port: 0, pingMs: 60_000, ice: async () => ({ policy: "relay", servers }) });
  try {
    const a = await RelayLink.open(relay.url);
    const b = await RelayLink.join(relay.url, a.room);
    expect(await a.ice).toEqual({ policy: "relay", servers });
    expect(await b.ice).toEqual({ policy: "relay", servers });
    a.close();
  } finally {
    await relay.close();
  }
  const plain = await startRelay({ port: 0, pingMs: 60_000 });
  try {
    const a = await RelayLink.open(plain.url);
    await RelayLink.join(plain.url, a.room);
    expect(await a.ice).toEqual(NO_ICE);
    a.close();
  } finally {
    await plain.close();
  }
});

import { expect, test } from "@playwright/test";
import { CallDesk, type CallEnd } from "../../src/tools/remote/call.ts";
import { type Signal, Signals, parseSignal } from "../../src/tools/remote/direct.ts";
import { NO_ICE, randomId } from "../../src/tools/remote/relay.ts";
import { wire } from "../helpers/channel-pair.ts";

// 視訊通話（src/tools/remote/call.ts）的信令。真的接通在瀏覽器測試（tests/e2e/remote-call.spec.ts）

test("通話的信令：編號要對，SDP 與候選照資料通道的規則檢查", () => {
  const n = randomId();
  const ok: Signal[] = [
    { t: "ring", n },
    { t: "pick", n },
    { t: "bye", n },
    { t: "bye", n, why: "unsupported" },
    { t: "coffer", n, sdp: "v=0" },
    { t: "canswer", n, sdp: "v=0" },
    { t: "ccand", n, c: { candidate: "candidate:1 1 udp 1 192.0.2.1 3478 typ relay", sdpMid: "0", sdpMLineIndex: 0 } },
    { t: "ccand", n, c: null },
  ];
  for (const s of ok) expect(parseSignal(JSON.stringify(s))).toEqual(s);
  for (const bad of [
    { t: "ring" },
    { t: "ring", n: "short" },
    { t: "pick", n: 42 },
    { t: "coffer", n, sdp: "x".repeat(20_000) },
    { t: "canswer", n },
    { t: "ccand", n, c: { candidate: 1 } },
  ])
    expect(parseSignal(JSON.stringify(bad))).toBeNull();
  // 不認得的理由不帶過去
  expect(parseSignal(JSON.stringify({ t: "bye", n, why: "other" }))).toEqual({ t: "bye", n });
});

test("不能視訊的一端收到邀請時回 unsupported，打的一端說明對方無法視訊", async () => {
  const [a, b] = wire();
  const caller = new Signals(a);
  // 這裡沒有 WebRTC，伺服器也沒有發 TURN
  const desk = new CallDesk(new Signals(b), NO_ICE);
  expect(desk.supported).toBe(false);
  const n = randomId();
  caller.send({ t: "ring", n });
  expect(await caller.next((s) => s.t === "bye", 1000)).toEqual({ t: "bye", n, why: "unsupported" });
  desk.close();
});

test("listen 接手已經排著的信令，連線結束時收到 null", async () => {
  const [a, b] = wire();
  const signals = new Signals(b);
  const n = randomId();
  new Signals(a).send({ t: "ring", n });
  await new Promise((r) => setTimeout(r, 10));
  const got: (Signal | null)[] = [];
  signals.listen((s) => {
    got.push(s);
    return s?.t === "ring";
  });
  expect(got).toEqual([{ t: "ring", n }]);
  // 收走的不會再交給 next()
  expect(await signals.next((s) => s.t === "ring", 50)).toBeNull();
  a.close();
  await new Promise((r) => setTimeout(r, 10));
  expect(got.at(-1)).toBeNull();
});

test("不能視訊時按下開始不會有通話，連線結束時也沒有要結束的通話", async () => {
  const [a, b] = wire();
  const desk = new CallDesk(new Signals(b), NO_ICE);
  const ends: CallEnd[] = [];
  desk.onChange((view, end) => {
    if (!view && end) ends.push(end);
  });
  // 不能視訊時 start() 什麼都不做
  await desk.start();
  expect(desk.view()).toBeNull();
  a.close();
  await new Promise((r) => setTimeout(r, 10));
  expect(ends).toEqual([]);
});

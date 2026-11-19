import { expect, test } from "@playwright/test";
import type { Data } from "../../src/tools/nearby/channel.ts";
import { agreeNonces } from "../../src/tools/nearby/confirm.ts";
import { confirmCode } from "../../src/tools/nearby/protocol.ts";
import { wire } from "../helpers/channel-pair.ts";

const fpA = Uint8Array.from({ length: 32 }, (_, i) => i);
const fpB = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);

test("兩端交換隨機數，算出同一個確認碼，每次連線都不同", async () => {
  const [a, b] = wire();
  const [x, y] = await Promise.all([agreeNonces(a, "offer"), agreeNonces(b, "answer")]);
  expect(x).toHaveLength(32);
  expect(x).toEqual(y);
  expect(confirmCode(fpA, fpB, x)).toBe(confirmCode(fpB, fpA, y));
  const [c, d] = wire();
  const [again] = await Promise.all([agreeNonces(c, "offer"), agreeNonces(d, "answer")]);
  expect(again).not.toEqual(x);
  // 同一組指紋，隨機數不同，確認碼就由隨機數決定
  expect(confirmCode(fpA, fpB, new Uint8Array(32))).not.toBe(confirmCode(fpA, fpB, new Uint8Array(32).fill(1)));
});

test("發起的一端先送雜湊，回應的一端看到雜湊才送出隨機數", async () => {
  const seen: string[] = [];
  const [a, b] = wire((_, d) => (seen.push(JSON.parse(d as string).t), d));
  const answering = agreeNonces(b, "answer");
  await new Promise((r) => setTimeout(r, 30));
  expect(seen).toEqual([]);
  await Promise.all([agreeNonces(a, "offer"), answering]);
  expect(seen).toEqual(["nonce-commit", "nonce", "nonce-reveal"]);
});

test("揭露的隨機數跟先前的雜湊不同，回應的一端停下來", async () => {
  // 中間的人看到回應那一端的隨機數之後，才想換掉發起那一端的
  const [a, b] = wire((from, d) => {
    const m = JSON.parse(d as string);
    return from === 0 && m.t === "nonce-reveal" ? JSON.stringify({ ...m, n: "00".repeat(16) }) : d;
  });
  const settled = await Promise.allSettled([agreeNonces(a, "offer"), agreeNonces(b, "answer")]);
  expect((settled[1] as PromiseRejectedResult).reason.message).toBe("bad-message");
});

test("中間的人跟兩端各交換一次，決定不了任何一邊的確認碼", async () => {
  // 中間的人對送出端扮回應、對接收端扮發起，兩邊各有一個它選不了的隨機數
  const [a, m1] = wire();
  const [m2, b] = wire();
  const fixed = () => new Uint8Array(16).fill(7);
  const [na, , , nb] = await Promise.all([agreeNonces(a, "offer"), agreeNonces(m1, "answer", fixed), agreeNonces(m2, "offer", fixed), agreeNonces(b, "answer")]);
  expect(na.subarray(16)).toEqual(fixed());
  expect(nb.subarray(0, 16)).toEqual(fixed());
  expect(na.subarray(0, 16)).not.toEqual(fixed());
  expect(nb.subarray(16)).not.toEqual(fixed());
});

test("對方是舊版（直接送檔案清單）或格式不對時停下來，不退回舊的做法", async () => {
  for (const [first, role, message] of [
    ['{"t":"files","files":[]}', "answer", "version"],
    ['{"t":"accept"}', "offer", "version"],
    ['{"t":"nonce-commit","v":2,"c":"00"}', "answer", "version"],
    ['{"t":"nonce-commit","v":1,"c":"zz"}', "answer", "bad-message"],
    ['{"t":"nonce","n":"abcd"}', "offer", "bad-message"],
    ["not json", "answer", "bad-message"],
  ] as const) {
    const [a, b] = wire();
    b.send(first as Data);
    await expect(agreeNonces(a, role), first).rejects.toThrow(message);
  }
  const [a, b] = wire();
  b.send(new ArrayBuffer(4));
  await expect(agreeNonces(a, "answer")).rejects.toThrow("version");
});

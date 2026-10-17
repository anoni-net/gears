import { expect, test } from "@playwright/test";
import { MAX_FILES, confirmCode, parseMessage } from "../../src/tools/nearby/protocol.ts";

const meta = { name: "gears-1.jpg", size: 1234, type: "image/jpeg", sha256: "a".repeat(64) };

test("合格的訊息照原樣讀出來，多出的欄位丟掉", () => {
  expect(parseMessage(JSON.stringify({ t: "files", files: [{ ...meta, extra: 1 }] }))).toEqual({ t: "files", files: [meta] });
  expect(parseMessage('{"t":"accept"}')).toEqual({ t: "accept" });
  expect(parseMessage('{"t":"file","i":3}')).toEqual({ t: "file", i: 3 });
  expect(parseMessage('{"t":"done","ok":[true,false]}')).toEqual({ t: "done", ok: [true, false] });
});

test("對方送來不合格的訊息一律擋下", () => {
  const bad = [
    "not json",
    '{"t":"nope"}',
    '{"t":"files","files":[]}',
    JSON.stringify({ t: "files", files: [{ ...meta, name: "../../etc/passwd" }] }),
    JSON.stringify({ t: "files", files: [{ ...meta, name: "a\\b" }] }),
    JSON.stringify({ t: "files", files: [{ ...meta, size: -1 }] }),
    JSON.stringify({ t: "files", files: [{ ...meta, size: 1.5 }] }),
    JSON.stringify({ t: "files", files: [{ ...meta, sha256: "xyz" }] }),
    JSON.stringify({ t: "files", files: Array(MAX_FILES + 1).fill(meta) }),
    '{"t":"file","i":-1}',
    '{"t":"done","ok":[1]}',
  ];
  for (const text of bad) expect(() => parseMessage(text), text.slice(0, 60)).toThrow("bad-message");
});

test("確認碼兩邊算出來相同，指紋換掉就不同", () => {
  const a = Uint8Array.from({ length: 32 }, (_, i) => i);
  const b = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
  const c = Uint8Array.from({ length: 32 }, (_, i) => (i * 3) & 255);
  expect(confirmCode(a, b)).toMatch(/^\d{3} \d{3}$/);
  expect(confirmCode(a, b)).toBe(confirmCode(b, a));
  expect(confirmCode(a, c)).not.toBe(confirmCode(a, b));
});

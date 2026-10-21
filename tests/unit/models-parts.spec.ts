import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { type Part, joinParts, partName } from "../../src/core/models.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// 一段的回應分成好幾塊送出，模擬網路上的下載
function response(data: Uint8Array, chunk = 1000) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < data.length; at += chunk) controller.enqueue(data.slice(at, at + chunk));
        controller.close();
      },
    }),
  );
}

const file = new Uint8Array(25_000).map((_, i) => (i * 31) % 251);
const pieces = [file.subarray(0, 10_000), file.subarray(10_000, 20_000), file.subarray(20_000)];
const parts: Part[] = pieces.map((p) => ({ sha256: sha256(p), bytes: p.length }));

test("每段的檔名接在原本的檔名後面", () => {
  expect(partName("onnx/decoder_model_merged_q4.onnx", 1)).toBe("onnx/decoder_model_merged_q4.onnx.part1");
});

test("依序下載每一段，接回原本的檔案，回報接好的位元組數", async () => {
  const asked: number[] = [];
  const seen: number[] = [];
  const out = await joinParts(
    parts,
    async (i) => {
      asked.push(i);
      return response(pieces[i]!);
    },
    (n) => seen.push(n),
  );
  expect(sha256(out)).toBe(sha256(file));
  expect(asked).toEqual([0, 1, 2]);
  expect(seen.at(-1)).toBe(25_000);
  expect(seen).toEqual([...seen].sort((a, b) => a - b));
});

test("任何一段的內容、長度或狀態不對就停下來", async () => {
  const wrong = new Uint8Array(pieces[1]!);
  wrong[5] = wrong[5]! ^ 1;
  await expect(joinParts(parts, async (i) => response(i === 1 ? wrong : pieces[i]!))).rejects.toThrow(/part 1: SHA-256 mismatch/);
  await expect(joinParts(parts, async (i) => response(i === 2 ? pieces[2]!.subarray(1) : pieces[i]!))).rejects.toThrow(/part 2: 4999 of 5000 bytes/);
  await expect(joinParts(parts, async (i) => response(i === 0 ? file.subarray(0, 10_001) : pieces[i]!))).rejects.toThrow(/part 0: longer/);
  await expect(joinParts(parts, async () => new Response(null, { status: 404 }))).rejects.toThrow(/part 0: HTTP 404/);
});

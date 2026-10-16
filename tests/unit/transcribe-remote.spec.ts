import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import models from "../../src/tools/transcribe/models.json" with { type: "json" };
import { REMOTE_ERROR, hfUrl, readVerified } from "../../src/tools/transcribe/remote.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// 分成好幾塊送出的回應，模擬網路上的下載
function chunked(data: Uint8Array, size: number, length?: number) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < data.length; at += size) controller.enqueue(data.slice(at, at + size));
      controller.close();
    },
  });
  return new Response(body, { headers: length === undefined ? {} : { "content-length": String(length) } });
}

test("下載網址鎖定 models.json 記錄的 commit", () => {
  expect(hfUrl(models.turbo.repo, models.turbo.revision, "onnx/encoder_model_q4.onnx")).toBe(
    `https://huggingface.co/onnx-community/whisper-large-v3-turbo/resolve/${models.turbo.revision}/onnx/encoder_model_q4.onnx`,
  );
  expect(models.turbo.host).toBe("hf");
  expect(models.small.host).toBe("self");
});

test("SHA-256 對得上時交出完整的內容，回報讀到的位元組數", async () => {
  const data = new Uint8Array(10_000).map((_, i) => i * 7);
  const seen: number[] = [];
  const out = await readVerified(chunked(data, 3000, data.length), sha256(data), (n) => seen.push(n));
  expect(out).toEqual(data);
  expect(seen).toEqual([3000, 6000, 9000, 10_000]);
});

test("沒有 Content-Length 或長度寫錯時照樣讀完", async () => {
  const data = new Uint8Array(5000).map((_, i) => i);
  expect(await readVerified(chunked(data, 999), sha256(data))).toEqual(data);
  expect(await readVerified(chunked(data, 999, 100), sha256(data))).toEqual(data);
  expect(await readVerified(chunked(data, 999, 9000), sha256(data))).toEqual(data);
});

test("SHA-256 對不上就丟出錯誤，訊息以 Hugging Face 開頭", async () => {
  const data = new Uint8Array([1, 2, 3]);
  await expect(readVerified(chunked(data, 2), sha256(new Uint8Array([1, 2, 4])))).rejects.toThrow(new RegExp(`^${REMOTE_ERROR}: SHA-256`));
});

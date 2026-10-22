import { expect, test } from "@playwright/test";
import { KEEP_CACHE, LLM_CACHE, classify, compareKeys } from "../../src/core/storage.ts";
import { MODEL_CACHE } from "../../src/core/models.ts";
import whisper from "../../src/tools/transcribe/models.json" with { type: "json" };

const at = (path: string) => `https://anoni.net/gears/${path}`;

test("依快取與網址分成一列一列", () => {
  expect(classify(MODEL_CACHE, at(`models/whisper/${whisper.base.dir}/onnx/encoder_model_quantized.onnx`), "/gears/")).toEqual({ group: "transcribe", model: "base" });
  expect(classify(MODEL_CACHE, at("models/whisper/whisper-base-0000000/config.json"), "/gears/")).toEqual({ group: "other" });
  expect(classify(MODEL_CACHE, at("models/speaker/campplus-x/model.onnx"), "/gears/")).toEqual({ group: "speaker" });
  expect(classify(KEEP_CACHE, at("models/yunet-2023mar-dynamic.onnx"), "/gears/")).toEqual({ group: "faces" });
  expect(classify(KEEP_CACHE, at("models/ppocr/PP-OCRv5_mobile_rec.onnx"), "/gears/")).toEqual({ group: "ocr" });
  expect(classify(KEEP_CACHE, at("vendor/pdfjs/cmaps/UniCNS-UCS2-H.bcmap"), "/gears/")).toEqual({ group: "pdf" });
  expect(classify(KEEP_CACHE, at("assets/ort-wasm-simd-threaded-AbC.wasm"), "/gears/")).toEqual({ group: "runtime" });
  expect(classify(KEEP_CACHE, at("vendor/sherpa/sherpa-onnx-wasm-web.wasm"), "/gears/")).toEqual({ group: "runtime" });
  expect(classify(KEEP_CACHE, at("assets/c2pa_bg-xyz.wasm"), "/gears/")).toEqual({ group: "c2pa" });
  expect(classify(LLM_CACHE, "https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/abc/onnx/model.onnx", "/gears/")).toEqual({ group: "llm" });
  // onion 版放在根目錄
  expect(classify(KEEP_CACHE, "http://gears.example.onion/models/yunet-2023mar-dynamic.onnx", "/")).toEqual({ group: "faces" });
  expect(classify(KEEP_CACHE, "https://example.org/elsewhere/file", "/gears/")).toEqual({ group: "other" });
});

test("逐字稿的模型照 models.json 的順序排在最前面，其他照用途", () => {
  const keys = [{ group: "llm" }, { group: "faces" }, { group: "transcribe", model: "base" }, { group: "other" }, { group: "transcribe", model: "small" }, { group: "ocr" }] as const;
  expect([...keys].sort(compareKeys)).toEqual([
    { group: "transcribe", model: "small" },
    { group: "transcribe", model: "base" },
    { group: "faces" },
    { group: "ocr" },
    { group: "llm" },
    { group: "other" },
  ]);
});

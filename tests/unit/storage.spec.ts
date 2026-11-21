import { expect, test } from "@playwright/test";
import { KEEP_CACHE, LLM_CACHE, OCR_MB, RUNTIME_MB, classify, compareKeys, redactDownload } from "../../src/core/storage.ts";
import { MODEL_CACHE } from "../../src/core/models.ts";
import whisper from "../../src/tools/transcribe/models.json" with { type: "json" };

const at = (path: string) => `https://anoni.net/gears/${path}`;

test("依快取與網址分成一列一列", () => {
  expect(classify(MODEL_CACHE, at(`models/whisper/${whisper.base.dir}/onnx/encoder_model_quantized.onnx`), "/gears/")).toEqual({ group: "transcribe", model: "base" });
  expect(classify(MODEL_CACHE, at("models/whisper/whisper-base-0000000/config.json"), "/gears/")).toEqual({ group: "other" });
  expect(classify(MODEL_CACHE, at("models/speaker/campplus-x/model.onnx"), "/gears/")).toEqual({ group: "speaker" });
  expect(classify(KEEP_CACHE, at("models/yunet-2023mar-dynamic.onnx"), "/gears/")).toEqual({ group: "faces" });
  // 個資辨識模型存在 transformers-cache，另外列一列，clearnet 與 onion 的網址都認得
  expect(classify(LLM_CACHE, "https://assets.anoni.net/gears/models/nym-pii-7ce7f1a/onnx/model_q4.onnx_data", "/gears/")).toEqual({ group: "pii" });
  expect(classify(LLM_CACHE, "http://gears.example.onion/models/assets/nym-pii-7ce7f1a/tokenizer.json", "/")).toEqual({ group: "pii" });
  expect(classify(LLM_CACHE, "https://assets.anoni.net/gears/models/qwen3-1.7b-3231b52/config.json", "/gears/")).toEqual({ group: "llm" });
  expect(classify(KEEP_CACHE, at("models/ppocr/PP-OCRv5_mobile_rec.onnx"), "/gears/")).toEqual({ group: "ocr" });
  expect(classify(KEEP_CACHE, at("models/bench/ocr-phone.png"), "/gears/")).toEqual({ group: "ocr" });
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

test("遮蔽的自動尋找還要下載多少：執行環境兩者共用，文字辨識要兩個模型都在", () => {
  const base = "/gears/";
  const runtime = "/gears/assets/ort-wasm-simd-threaded-Redact01.wasm";
  const ort = `https://anoni.net${runtime}`;
  const det = "https://anoni.net/gears/models/ppocr/PP-OCRv5_mobile_det.onnx";
  const rec = "https://anoni.net/gears/models/ppocr/PP-OCRv5_mobile_rec.onnx";
  const yunet = "https://anoni.net/gears/models/yunet-2023mar-dynamic.onnx";
  const need = (paths: string[]) => redactDownload(paths, base, runtime);
  expect(need([])).toEqual({ faces: RUNTIME_MB, text: RUNTIME_MB + OCR_MB });
  // 用過找人臉：執行環境已經在，文字辨識只差模型
  expect(need([ort, yunet])).toEqual({ faces: 0, text: OCR_MB });
  expect(need([ort, det])).toEqual({ faces: 0, text: OCR_MB });
  expect(need([ort, det, rec])).toEqual({ faces: 0, text: 0 });
  // 只有模型、沒有執行環境時仍要下載執行環境
  expect(need([det, rec])).toEqual({ faces: RUNTIME_MB, text: RUNTIME_MB });
  // Transformers.js 帶的另一份 onnxruntime（逐字稿用的）不算
  expect(need(["https://anoni.net/gears/assets/ort-wasm-simd-threaded-Tjs00002.wasm"])).toEqual({ faces: RUNTIME_MB, text: RUNTIME_MB + OCR_MB });
  // onion 版的路徑在根目錄
  expect(redactDownload(["http://x.onion/assets/ort-wasm-a.wasm"], "/", "/assets/ort-wasm-a.wasm")).toEqual({ faces: 0, text: OCR_MB });
});

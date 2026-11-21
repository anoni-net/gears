import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { MODEL_CATALOG, catalogRange } from "../../src/core/model-catalog.ts";
import { OCR_MB } from "../../src/core/storage.ts";
import { PII_MB, PII_MODEL } from "../../src/tools/redact/pii-model.ts";
import ppocr from "../../src/tools/redact/ppocr-models.json" with { type: "json" };
import yunet from "../../src/tools/redact/yunet-model.json" with { type: "json" };
import { PUNCT_MB, PUNCT_MODEL } from "../../src/tools/transcribe/punct.ts";
import whisper from "../../src/tools/transcribe/models.json" with { type: "json" };
import speaker from "../../src/tools/transcribe/speaker-model.json" with { type: "json" };
import vad from "../../src/tools/transcribe/vad-model.json" with { type: "json" };

// 設計原則頁的模型表（src/core/model-catalog.ts）：每一列的大小與授權都來自模型自己的設定

test("YuNet 的設定跟進版控的模型檔一致", () => {
  const file = readFileSync(new URL(`../../public/models/${yunet.file}`, import.meta.url));
  expect(file.length).toBe(yunet.bytes);
  expect(createHash("sha256").update(file).digest("hex")).toBe(yunet.sha256);
});

test("模型表列出每一個工具用到的模型，大小跟各自的設定相同", () => {
  const byId = new Map(MODEL_CATALOG.map((m) => [m.id, m]));
  expect(byId.size).toBe(MODEL_CATALOG.length);
  expect(MODEL_CATALOG.length).toBe(Object.keys(whisper).length + 6);
  expect(byId.get("yunet")!.bytes).toBe(yunet.bytes);
  expect(byId.get("ppocr")!.bytes).toBe(ppocr.det.bytes + ppocr.rec.bytes);
  expect(Math.round(byId.get("ppocr")!.bytes / 1e6)).toBe(OCR_MB);
  // 個資辨識與標點模型照工具畫面寫的下載量（經過 Cloudflare 的傳輸量）
  expect(Math.round(byId.get("pii")!.bytes / 1e6)).toBe(PII_MB);
  expect(byId.get("pii")!.license).toBe(PII_MODEL.license);
  expect(Math.round(byId.get("punct")!.bytes / 1e6)).toBe(PUNCT_MB);
  expect(byId.get("punct")!.license).toBe(PUNCT_MODEL.license);
  expect(byId.get("vad")!.bytes).toBe(vad.bytes);
  expect(byId.get("speaker")!.bytes).toBe(speaker.bytes);
  for (const [id, m] of Object.entries(whisper)) {
    expect(byId.get(id)!.bytes, id).toBe(m.bytes);
    expect(byId.get(id)!.license, id).toBe(m.license);
  }
  for (const m of MODEL_CATALOG) {
    expect(m.source, m.id).toMatch(/^https:\/\//);
    // onion 版的產物不能出現 clearnet 的 anoni.net（AGENTS.md「onion 版與 Tor Browser」）
    expect(m.source, m.id).not.toContain("anoni.net");
    expect(["MIT", "Apache-2.0"], m.id).toContain(m.license);
  }
});

test("下載量的範圍是表格裡最小與最大的模型", () => {
  const { min, max } = catalogRange();
  const sizes = MODEL_CATALOG.map((m) => m.bytes);
  expect(min.bytes).toBe(Math.min(...sizes));
  expect(max.bytes).toBe(Math.max(...sizes));
});

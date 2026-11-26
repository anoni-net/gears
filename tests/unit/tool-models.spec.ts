import { expect, test } from "@playwright/test";
import { MODEL_CATALOG, TOOL_MODELS, toolsUsing } from "../../src/core/model-catalog.ts";
import { TOOL_META } from "../../src/ui/tool-meta.ts";

// 工具頁的「用到的開源模型」與已下載的模型的「用在哪個工具」都讀 TOOL_MODELS（src/core/model-catalog.ts）
test("標了開源本機模型的工具都列出用到的模型，每個模型都在模型表裡", () => {
  const tagged = Object.entries(TOOL_META)
    .filter(([, meta]) => meta.tags?.includes("model"))
    .map(([id]) => id)
    .sort();
  expect(Object.keys(TOOL_MODELS).sort()).toEqual(tagged);
  const ids = new Set(MODEL_CATALOG.map((m) => m.id));
  for (const models of Object.values(TOOL_MODELS)) for (const m of models) expect(ids, m).toContain(m);
  // 模型表裡的每個模型都有工具用到
  for (const m of MODEL_CATALOG) expect(toolsUsing(m.id).length, m.id).toBeGreaterThan(0);
  expect(toolsUsing("pii")).toEqual(["redact", "transcribe", "writing-style"]);
  expect(toolsUsing("ppocr")).toEqual(["redact", "url-check"]);
});

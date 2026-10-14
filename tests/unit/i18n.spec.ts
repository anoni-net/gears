import { expect, test } from "@playwright/test";
import { FINDING_CODES, SEGMENT_CODES } from "../../src/core/tool.ts";
import { zhTW } from "../../src/i18n/zh-TW.ts";
import { createTools, fileTools, toolIds } from "../../src/tools/index.ts";

// 介面上有些字串的鍵是組出來的（finding.location、tool.qrcode.desc），漏了翻譯不會
// 在型別檢查時被抓到，畫面上會直接露出鍵名。
test("每個代碼與工具都有正體中文的字串", () => {
  const keys = new Set(Object.keys(zhTW));
  const expected = [
    ...FINDING_CODES.map((c) => `finding.${c}`),
    ...SEGMENT_CODES.map((c) => `segment.${c}`),
    ...toolIds.flatMap((id) => [`tool.${id}`, `tool.${id}.desc`, `meta.${id}.title`, `meta.${id}.description`]),
    // 會在暫存區留下版本的工具，版本列要有名稱
    ...[...fileTools, ...createTools.filter((tool) => tool.output === "file")].map((tool) => `file.version.${tool.id}`),
  ];
  expect(expected.filter((k) => !keys.has(k))).toEqual([]);
});

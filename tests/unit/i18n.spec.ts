import { expect, test } from "@playwright/test";
import { FINDING_CODES, SEGMENT_CODES } from "../../src/core/tool.ts";
import { zhTW } from "../../src/i18n/zh-TW.ts";
import { tools } from "../../src/tools/index.ts";

// 介面上有些字串的鍵是組出來的（finding.location、segment.exif），漏了翻譯不會在
// 型別檢查時被抓到，畫面上會直接露出鍵名。
test("每個代碼與工具都有正體中文的字串", () => {
  const keys = new Set(Object.keys(zhTW));
  const expected = [
    ...FINDING_CODES.map((c) => `finding.${c}`),
    ...SEGMENT_CODES.map((c) => `segment.${c}`),
    ...tools.flatMap((tool) => [`tool.${tool.id}`, `file.version.${tool.id}`]),
  ];
  expect(expected.filter((k) => !keys.has(k))).toEqual([]);
});

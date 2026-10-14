import { expect, test } from "@playwright/test";
import { FINDING_CODES, SEGMENT_CODES } from "../../src/core/tool.ts";
import { tDynamic } from "../../src/i18n/index.ts";
import { zhTW } from "../../src/i18n/zh-TW.ts";
import { createTools, editorTools, fileTools, toolIds } from "../../src/tools/index.ts";

// 介面上有些字串的鍵是組出來的（finding.location、tool.qrcode.desc），漏了翻譯不會
// 在型別檢查時被抓到，畫面上會直接露出鍵名。
test("每個代碼與工具都有正體中文的字串", () => {
  const keys = new Set(Object.keys(zhTW));
  const expected = [
    ...FINDING_CODES.map((c) => `finding.${c}`),
    ...SEGMENT_CODES.map((c) => `segment.${c}`),
    ...toolIds.flatMap((id) => [`tool.${id}`, `tool.${id}.desc`, `meta.${id}.title`, `meta.${id}.description`]),
    // 檔案畫面的工具列：按鈕用動詞，需要編輯畫面的工具還有「再做一次」
    ...[...fileTools, ...editorTools].map((tool) => `tool.${tool.id}.action`),
    ...editorTools.map((tool) => `tool.${tool.id}.again`),
    // 會在暫存區留下版本的工具，版本列要有名稱
    ...[...fileTools, ...editorTools, ...createTools.filter((tool) => tool.output === "file")].map((tool) => `file.version.${tool.id}`),
  ];
  expect(expected.filter((k) => !keys.has(k))).toEqual([]);
});

test("同一個變數出現兩次，兩處都會替換", () => {
  expect(tDynamic("url.warn.brandSubdomain", { detail: "shopee" })).toBe("「shopee」出現在子網域裡，網站本身並不是 shopee");
});

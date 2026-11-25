import { expect, test } from "@playwright/test";
import { FINDING_CODES, SEGMENT_CODES } from "../../src/core/tool.ts";
import { tDynamic } from "../../src/i18n/index.ts";
import { zhTW } from "../../src/i18n/zh-TW.ts";
import { createTools, editorTools, fileTools, toolIds } from "../../src/tools/index.ts";
import { TOOL_GROUPS } from "../../src/ui/tool-meta.ts";
import { PII_KINDS } from "../../src/tools/redact/pii.ts";
import { CLUES } from "../../src/tools/writing-style/index.ts";
import qrSamples from "../../src/tools/qr-read/samples.json" with { type: "json" };
import { MODEL_CATALOG } from "../../src/core/model-catalog.ts";
import { USER_PAGES } from "../../src/ui/tool-meta.ts";
import { pageIds } from "../../src/pages.ts";
import { AI_NOTES, GAPS, LINKS, PEERS, RELATIONS } from "../../src/ui/why-peers.ts";

// 介面上有些字串的鍵是組出來的（finding.location、tool.qrcode.desc），漏了翻譯不會
// 在型別檢查時被抓到，畫面上會直接露出鍵名。
test("每個代碼與工具都有正體中文的字串", () => {
  const keys = new Set(Object.keys(zhTW));
  const expected = [
    ...FINDING_CODES.map((c) => `finding.${c}`),
    ...SEGMENT_CODES.map((c) => `segment.${c}`),
    ...toolIds.flatMap((id) => [`tool.${id}`, `tool.${id}.desc`, `meta.${id}.title`, `meta.${id}.description`]),
    // 桌面每個工具一列，名稱下面一行寫讀者會遇到的情況（src/ui/Desktop.tsx）
    ...TOOL_GROUPS.flatMap((group) => group.tools.map((id) => `desk.when.${id}`)),
    // 檔案畫面的工具列：按鈕用動詞，需要編輯畫面的工具還有「再做一次」
    ...fileTools.map((tool) => `tool.${tool.id}.action`),
    // 工具頁開頭的使用方式，每個工具三步，處理檔案與從空白開始的工具都有（src/ui/ToolIntro.tsx 的 ToolHeader）
    ...toolIds.flatMap((id) => [1, 2, 3].map((n) => `howto.${id}.${n}`)),
    ...editorTools.map((tool) => `tool.${tool.id}.again`),
    // 產生檔案放進暫存區的工具，處理紀錄的第一步寫出是哪個工具建立的（src/ui/FileView.tsx 的 History）
    // 逐字稿與影片的關鍵影格也會把產生的檔案放進暫存區
    ...[...createTools.filter((tool) => tool.output === "file").map((tool) => tool.id), "transcribe", "video-frames"].map((id) => `file.version.${id}`),
    // 寫作習慣檢查：個資的類別與代稱，以及工具找不到的線索（src/ui/WritingStyleTool.tsx）
    ...PII_KINDS.flatMap((kind) => [`style.pii.${kind}`, `style.piiTag.${kind}`]),
    ...Array.from({ length: CLUES }, (_, i) => `style.clues.${i + 1}`),
    // QR code 讀取的範例與分組
    ...qrSamples.flatMap((sample) => [`qrread.sample.${sample.id}`, `qrread.samples.${sample.group}`]),
    // 設計原則頁的模型表：每個模型用在哪個工具（src/core/model-catalog.ts）
    ...MODEL_CATALOG.map((m) => `about.use.${m.id}`),
    // 工具以外的頁面：標題與搜尋結果的描述，使用者區的頁面另外要有桌面上的名稱
    ...pageIds.flatMap((id) => [`${id}.title`, `meta.${id}.title`, `meta.${id}.description`]),
    ...USER_PAGES.map((id) => `${id}.title`),
    // 為什麼做 Gears 的同類工具（src/ui/why-peers.ts）：列進對照表的另外要有「檔案經過誰」
    ...PEERS.flatMap((p) => [`why.peer.${p.id}.who`, `why.peer.${p.id}.form`, `why.peer.${p.id}.body`, ...(p.covers?.length ? [`why.peer.${p.id}.path`] : [])]),
    ...RELATIONS.map((r) => `why.rel.${r}`),
    ...AI_NOTES.map((n) => `why.ai.${n.id}`),
    ...LINKS.flatMap(({ id }) => [`why.links.${id}.title`, `why.links.${id}.body`]),
    ...Array.from({ length: GAPS }, (_, i) => [`why.gaps.${i + 1}.title`, `why.gaps.${i + 1}.body`]).flat(),
    ...TOOL_GROUPS.map((g) => `why.situation.${g.id}`),
  ];
  expect(expected.filter((k) => !keys.has(k))).toEqual([]);
});

test("同一個變數出現兩次，兩處都會替換", () => {
  expect(tDynamic("url.warn.brandSubdomain", { detail: "shopee" })).toBe("「shopee」出現在子網域裡，網站本身並不是 shopee");
});

test("每個語系的鍵都齊全，變數一致", async () => {
  const { LOCALES, messagesOf } = await import("../../src/i18n/index.ts");
  const vars = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
  for (const locale of LOCALES) {
    const messages = messagesOf(locale.id) as Record<string, string>;
    expect(Object.keys(messages).sort(), locale.id).toEqual(Object.keys(zhTW).sort());
    for (const [key, value] of Object.entries(zhTW)) {
      expect(messages[key]!.length, `${locale.id} ${key}`).toBeGreaterThan(0);
      expect(vars(messages[key]!), `${locale.id} ${key}`).toEqual(vars(value));
    }
  }
});

test("網址決定語系", async () => {
  const { localeFromPath } = await import("../../src/i18n/index.ts");
  expect(localeFromPath("/gears/")).toBe("zh-TW");
  expect(localeFromPath("/gears/qrcode/")).toBe("zh-TW");
  expect(localeFromPath("/gears/zh-cn/qrcode/")).toBe("zh-CN");
  expect(localeFromPath("/gears/en/")).toBe("en");
});

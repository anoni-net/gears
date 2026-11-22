import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toolIds } from "../../src/tools/index.ts";
import { ICON_PATHS } from "../../src/ui/icon-paths.ts";
import { GROUP_CAT, PAGE_META, TOOL_GROUPS, TOOL_META, USER_PAGES } from "../../src/ui/tool-meta.ts";
import { labIds, pageIds } from "../../src/pages.ts";

test("每個工具都有圖示，圖示圈的顏色跟著桌面的分組", () => {
  for (const group of TOOL_GROUPS)
    for (const id of group.tools) {
      const meta = TOOL_META[id];
      expect(meta, id).toBeDefined();
      expect(Object.hasOwn(ICON_PATHS, meta!.icon), id).toBe(true);
      expect(meta!.cat, id).toBe(GROUP_CAT[group.id]);
    }
  // 三組三個顏色
  expect(new Set(Object.values(GROUP_CAT)).size).toBe(TOOL_GROUPS.length);
});

test("使用者區的頁面都有圖示，也都是工具以外的頁面", () => {
  for (const id of USER_PAGES) {
    expect(Object.hasOwn(ICON_PATHS, PAGE_META[id].icon), id).toBe(true);
    expect(pageIds, id).toContain(id);
  }
  // 設計原則頁是理解 Gears 的入口，排在使用者區最前面，搜尋引擎可以收錄
  expect(USER_PAGES[0]).toBe("about");
  expect(labIds).not.toContain("about");
});

test("每個工具剛好出現在桌面的一組", () => {
  const grouped: string[] = TOOL_GROUPS.flatMap((g) => [...g.tools]);
  expect([...grouped].sort()).toEqual([...toolIds].sort());
  expect(new Set(grouped).size).toBe(grouped.length);
});

test("暫存區每種格式都有存在的檔案類型圖示", async () => {
  const { fileIcon } = await import("../../src/ui/file-icon.ts");
  const { ICON_PATHS } = await import("../../src/ui/icon-paths.ts");
  for (const format of ["docx", "xlsx", "pdf", "mp3", "mov", "zip", "age", "torrent", "epub", "html", "heic", "unknown"] as const) {
    expect(fileIcon(format, format === "heic") in ICON_PATHS, format).toBe(true);
  }
  expect(fileIcon("heic", true)).toBe("file-image-outline");
  expect(fileIcon("unknown", false)).toBe("file-outline");
});

// 圖示標籤（src/ui/tool-tags.ts）
test("每個標籤都有圖示與三個語系的說明，每個工具最多兩個標籤，每個工具的標籤都有補充說明", async () => {
  const { TAGS, TAG_ORDER, MAX_TAGS } = await import("../../src/ui/tool-tags.ts");
  const { LOCALES, messagesOf } = await import("../../src/i18n/index.ts");
  const css = readFileSync(join(import.meta.dirname, "../../src/styles.css"), "utf8");
  for (const tag of TAG_ORDER) {
    expect(Object.hasOwn(ICON_PATHS, TAGS[tag].icon), tag).toBe(true);
    // 標籤一律中性灰，不另訂代表色
    expect(css, `--tag-${tag}`).not.toContain(`--tag-${tag}:`);
  }
  for (const id of toolIds) {
    const tags = TOOL_META[id]!.tags ?? [];
    expect(tags.length, id).toBeLessThanOrEqual(MAX_TAGS);
    expect(new Set(tags).size, id).toBe(tags.length);
    for (const locale of LOCALES) {
      const messages = messagesOf(locale.id) as Record<string, string>;
      for (const tag of tags) {
        expect(messages[`tag.${tag}`], `${locale.id} tag.${tag}`).toBeTruthy();
        expect(messages[`tag.${tag}.desc`], `${locale.id} tag.${tag}.desc`).toBeTruthy();
        expect(messages[`tag.${tag}.${id}`], `${locale.id} tag.${tag}.${id}`).toBeTruthy();
      }
    }
  }
});

// 從每個工具的畫面元件沿著 import 一路往下追（只追 src 底下的相對路徑），收集所有原始碼
const ui = join(import.meta.dirname, "../../src/ui");
function sourcesOf(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  const out: string[] = [];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    out.push(source);
    for (const m of source.matchAll(/(?:from\s*|import\(\s*)"(\.{1,2}\/[^"?]+)(?:\?[^"]*)?"/g)) {
      const base = join(dirname(file), m[1]!);
      const found = [base, `${base}.ts`, `${base}.tsx`].find((p) => existsSync(p) && /\.tsx?$/.test(p));
      if (found) stack.push(found);
    }
  }
  return out;
}
const registry = readFileSync(join(ui, "registry.tsx"), "utf8");
const toolSources: Record<string, string[]> = {};
for (const m of registry.matchAll(/^\s+"?([a-z-]+)"?: \(\) => import\("\.\/([\w.-]+\.tsx)"\)/gm)) toolSources[m[1]!] = sourcesOf(join(ui, m[2]!));

// 能從程式判斷的標籤：用到了卻沒標、標了卻沒用到，都會失敗
const DETECT: Record<string, (sources: string[]) => boolean> = {
  // 模型的執行環境：onnxruntime、Transformers.js，以及逐字稿另外載入的 sherpa-onnx
  model: (sources) => sources.some((s) => /from "(onnxruntime-web|@huggingface\/transformers)|import\("(onnxruntime-web|@huggingface\/transformers)|vendor\/sherpa/.test(s)),
  camera: (sources) => sources.some((s) => s.includes("getUserMedia")),
  // 經過伺服器：連到社群的轉送服務（WebSocket）。之後新增連網的工具，沒標會失敗
  server: (sources) => sources.some((s) => /new WebSocket\(/.test(s)),
};

test("標籤跟程式實際做的事一致：開源本機模型、相機、經過伺服器", () => {
  expect(Object.keys(toolSources).length).toBeGreaterThan(10);
  for (const id of toolIds) {
    for (const [tag, detect] of Object.entries(DETECT)) {
      const marked = (TOOL_META[id]!.tags ?? []).includes(tag as never);
      expect(marked, `${id} ${tag}`).toBe(!!toolSources[id] && detect(toolSources[id]!));
    }
  }
});

// 工具頁使用方式的流程（src/ui/howto-icons.ts）：每個工具三步各一個圖示
test("每個工具的使用方式三步都有圖示", async () => {
  const { HOWTO_ICONS } = await import("../../src/ui/howto-icons.ts");
  const { toolIds } = await import("../../src/tools/index.ts");
  expect(Object.keys(HOWTO_ICONS).sort()).toEqual([...toolIds].sort());
  for (const [id, icons] of Object.entries(HOWTO_ICONS)) {
    expect(icons, id).toHaveLength(3);
    for (const icon of icons) expect(Object.hasOwn(ICON_PATHS, icon), `${id} ${icon}`).toBe(true);
  }
});

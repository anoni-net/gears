import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolIds } from "../../src/tools/index.ts";
import { ICON_PATHS } from "../../src/ui/icon-paths.ts";
import { TOOL_GROUPS, TOOL_META } from "../../src/ui/tool-meta.ts";

test("每個工具都有圖示與類別", () => {
  for (const id of toolIds) {
    const meta = TOOL_META[id];
    expect(meta, id).toBeDefined();
    expect(Object.hasOwn(ICON_PATHS, meta!.icon), id).toBe(true);
    expect(["privacy", "secure"]).toContain(meta!.cat);
  }
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

// 會在瀏覽器裡執行模型的模組：逐字稿與 Omnilingual 的 Worker、遮蔽的自動尋找與文字辨識
const MODEL_MODULES = ["transcribe.worker", "sherpa.worker", "redact-detect", "tesseract", "speaker-embed"];

test("用到模型的工具在桌面上有標記，沒用到的沒有", () => {
  // 從 src/ui/registry.tsx 找出每個工具的畫面元件，看它有沒有直接引用模型的模組
  const ui = join(import.meta.dirname, "../../src/ui");
  const registry = readFileSync(join(ui, "registry.tsx"), "utf8");
  const uses: Record<string, boolean> = {};
  for (const m of registry.matchAll(/^\s+"?([a-z-]+)"?: \(\) => import\("\.\/([\w.-]+\.tsx)"\)/gm)) {
    const source = readFileSync(join(ui, m[2]!), "utf8");
    uses[m[1]!] = MODEL_MODULES.some((name) => source.includes(`./${name}`));
  }
  expect(Object.keys(uses).length).toBeGreaterThan(10);
  for (const id of toolIds) expect(!!TOOL_META[id]!.model, id).toBe(!!uses[id]);
  // 逐字稿本身就靠模型，遮蔽只有自動尋找用到
  expect(TOOL_META.transcribe!.model).toBe("core");
  expect(TOOL_META.redact!.model).toBe("assist");
});

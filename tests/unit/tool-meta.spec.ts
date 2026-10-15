import { expect, test } from "@playwright/test";
import { toolIds } from "../../src/tools/index.ts";
import { ICON_PATHS } from "../../src/ui/icon-paths.ts";
import { TOOL_META } from "../../src/ui/tool-meta.ts";

test("每個工具都有圖示與類別", () => {
  for (const id of toolIds) {
    const meta = TOOL_META[id];
    expect(meta, id).toBeDefined();
    expect(Object.hasOwn(ICON_PATHS, meta!.icon), id).toBe(true);
    expect(["privacy", "secure"]).toContain(meta!.cat);
  }
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

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

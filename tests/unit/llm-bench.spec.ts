import { expect, test } from "@playwright/test";
import models from "../../src/tools/llm-bench/models.json" with { type: "json" };

test("models.json：社群轉檔的模型列出每個檔案的 SHA-256，切段的檔案大小加總一致，每段都在 Cloudflare 的快取上限以下", () => {
  for (const [id, info] of Object.entries(models)) {
    expect(["hf", "assets"], id).toContain(info.host);
    if (!("dir" in info)) {
      expect(info.host, id).toBe("hf");
      continue;
    }
    expect(info.host, id).toBe("assets");
    // 目錄名稱帶著 ONNX 檔來源的 commit，內容不會變
    expect(info.dir, id).toContain(info.revision.slice(0, 7));
    const files = info.files as Record<string, string>;
    for (const sha256 of Object.values(files)) expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const [file, parts] of Object.entries(info.parts as Record<string, { sha256: string; bytes: number }[]>)) {
      expect(files[file], `${id} ${file}`).toBeDefined();
      for (const part of parts) {
        expect(part.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(part.bytes).toBeLessThan(512 * 1024 * 1024);
      }
    }
    const data = Object.keys(files).filter((f) => f.endsWith(".onnx_data"));
    expect(data.every((f) => f in info.parts), id).toBe(true);
    const bytes = Object.values(info.parts as Record<string, { bytes: number }[]>).flat().reduce((n, p) => n + p.bytes, 0);
    // models.json 的 gpu.bytes 是畫面上顯示的下載量，跟實際的檔案相差不到 5%
    expect(Math.abs(bytes - info.gpu.bytes) / info.gpu.bytes, id).toBeLessThan(0.05);
  }
});

import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AI_NOTES, LINKS, PEERS } from "../../src/ui/why-peers.ts";
import peerLogos from "../../scripts/peer-logos.json" with { type: "json" };

// 為什麼做 Gears 的同類工具圖示（public/peers/）：頁面用到的、產生的腳本、資料夾裡的檔案與
// licenses/peer-logos.txt 列的要是同一批，每個都是 64 × 64 的小 PNG

const { logos: LOGOS, size: SIZE } = peerLogos;
const dir = join(import.meta.dirname, "../../public/peers");
const used = new Set([...PEERS.flatMap((p) => p.names), ...AI_NOTES.flatMap((n) => n.names)].flatMap((n) => (n.logo ? [n.logo] : [])).concat(LINKS.flatMap((l) => l.logos)));
const files = readdirSync(dir).filter((f) => !f.startsWith("."));
const license = readFileSync(join(import.meta.dirname, "../../licenses/peer-logos.txt"), "utf8");

test("頁面用到的圖示、產生的腳本、資料夾與授權檔列的是同一批", () => {
  const scripted = LOGOS.map((l) => l.id).sort();
  expect([...used].sort()).toEqual(scripted);
  expect(files.sort()).toEqual(scripted.map((id) => `${id}.png`));
  for (const f of files) expect(license, f).toContain(`- ${f}\n`);
});

test("每個圖示都是 64 × 64 的 PNG，不超過 16 KB", () => {
  for (const f of files) {
    const bytes = readFileSync(join(dir, f));
    expect(bytes.subarray(1, 4).toString(), f).toBe("PNG");
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], f).toEqual([SIZE, SIZE]);
    expect(statSync(join(dir, f)).size, f).toBeLessThanOrEqual(16 * 1024);
  }
});

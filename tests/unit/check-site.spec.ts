import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error 部署用的腳本是 .mjs，沒有型別
import { clearnetRefs, missingFiles } from "../../scripts/check-site.mjs";

function site(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "gears-site-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const ok = {
  "index.html": '<script type="module" src="/gears/assets/index-A.js"></script><link rel="modulepreload" href="/gears/assets/jsxRuntime-A.js">',
  "sw.js": 'const VERSION = "x";\nconst FILES = ["index.html","assets/index-A.js","assets/jsxRuntime-A.js"];',
  "assets/index-A.js": 'import{a}from"./jsxRuntime-A.js";m.f||(m.f=["assets/Tool-A.js"]);import("./Tool-A.js")',
  "assets/jsxRuntime-A.js": "",
  "assets/Tool-A.js": 'import{a}from"./jsxRuntime-A.js"',
};

test("參照到的檔案都在時沒有缺漏", () => {
  expect(missingFiles(site(ok))).toEqual([]);
});

test("頁面與 sw.js 沒有更新、新的程式參照到另一個檔案時列出缺漏", () => {
  // 2026-10-17 的部署：程式換成新的一版，頁面與 sw.js 還是舊的
  const files: Record<string, string> = { ...ok, "assets/jsxRuntime-B.js": "", "assets/Tool-A.js": 'import{a}from"./jsxRuntime-B.js"' };
  delete files["assets/jsxRuntime-A.js"];
  const dir = site(files);
  const missing = missingFiles(dir).join("\n");
  expect(missing).toContain("assets/jsxRuntime-A.js（sw.js）");
  expect(missing).toContain("assets/jsxRuntime-A.js（index.html）");
  expect(missing).toContain("assets/jsxRuntime-A.js（assets/index-A.js）");
  expect(missing).not.toContain("jsxRuntime-B");
});

test("onion 版放在根目錄，用網站的路徑比對頁面載入的檔案", () => {
  const onion = { ...ok, "index.html": ok["index.html"].replaceAll("/gears/assets/", "/assets/") };
  expect(missingFiles(site(onion), "/")).toEqual([]);
  // 路徑給錯時一個參照都比對不到，不能當成全部都在
  expect(missingFiles(site(onion)).join("\n")).toContain("網站的路徑是否正確");
});

test("onion 版連到 clearnet 的 anoni.net 時列出來，授權說明的文字檔不算", () => {
  const clean = site({ ...ok, "assets/licenses.txt": "來源 https://assets.anoni.net/gears/models/" });
  expect(clearnetRefs(clean)).toEqual([]);
  const leaky = site({ ...ok, "assets/Tool-A.js": 'fetch("https://aa.anoni.net/api/send")' });
  expect(clearnetRefs(leaky)).toEqual(["assets/Tool-A.js：https://aa.anoni.net"]);
});

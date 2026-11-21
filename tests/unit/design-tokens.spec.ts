import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// AGENTS.md「設計語言」的字級、間距與圓角：樣式只用 :root 的級距（--fs-*、--sp-*、--radius*）。
// 原本字級有 18 種、間距 28 種、圓角 11 種，0.85、0.875、0.9、0.9375、0.95rem 這種肉眼分不出的值各寫各的
const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// 每條規則的 selector 與宣告。@media 裡的規則一樣讀得到（內層沒有大括號）
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1]!.trim().replace(/\s+/g, " "),
  body: m[2]!,
}));

// 頁首照新聞導讀的排版（AGENTS.md「Logo、圖示與配色」），字級與間距跟著它，不套 Gears 的級距
const HEADER = /^\.site-header__/;

const decls = (prop: RegExp) =>
  rules.flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|[;\\s])(${prop.source}):\\s*([^;]+);`, "g"))].map((m) => ({ selector: r.selector, prop: m[1]!, value: m[2]!.trim() })));

test("字級只用 --fs-*", () => {
  const ok = /^(var\(--fs-(xs|sm|md|lg|xl)\)|inherit|max\(1rem, 16px\))$/; // max(1rem, 16px)：iOS 的輸入框小於 16px 會放大畫面
  const bad = decls(/font-size/).filter((d) => !HEADER.test(d.selector) && !ok.test(d.value));
  expect(bad).toEqual([]);
});

test("margin、padding、gap 的 rem 值只用 --sp-*", () => {
  const bad = decls(/(?:margin|padding)(?:-[a-z-]+)?|gap|row-gap|column-gap/).filter((d) => !HEADER.test(d.selector) && /\d(\.\d+)?rem/.test(d.value));
  expect(bad).toEqual([]);
});

test("圓角只用 --radius-sm、--radius、--radius-pill", () => {
  const ok = /^(var\(--radius(-sm|-pill)?\)|0|50%|inherit)( (var\(--radius(-sm|-pill)?\)|0))*$/;
  const bad = decls(/border-radius/).filter((d) => !ok.test(d.value));
  expect(bad).toEqual([]);
});

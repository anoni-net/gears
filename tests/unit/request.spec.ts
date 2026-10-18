import { expect, test } from "@playwright/test";
import { LOCALES } from "../../src/i18n/index.ts";
import { REQUEST_SURVEYS, requestUrl } from "../../src/request.ts";

test("需求表單的網址：每個語系一份問卷，帶上工具、語系與版本", () => {
  const url = new URL(requestUrl("redact", "zh-TW", "2026.10.18 14:05 ba8342a"));
  expect(url.origin).toBe("https://form.anoni.net");
  expect(url.pathname).toBe(`/s/${REQUEST_SURVEYS["zh-TW"]}`);
  expect(Object.fromEntries(url.searchParams)).toEqual({ tool: "redact", locale: "zh-TW", version: "2026.10.18 14:05 ba8342a" });
  // 只帶這三個欄位，對應問卷的 hidden fields
  expect([...url.searchParams.keys()]).toEqual(["tool", "locale", "version"]);
});

test("需求表單：桌面寫成 home，三個語系的問卷各不相同", () => {
  expect(new URL(requestUrl("", "en", "v")).searchParams.get("tool")).toBe("home");
  const ids = LOCALES.map((l) => REQUEST_SURVEYS[l.id]);
  expect(new Set(ids).size).toBe(LOCALES.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9]{25}$/);
});

test("需求表單：onion 版換成 onion 的表單網址", () => {
  const url = new URL(requestUrl("qrcode", "zh-CN", "v", "http://form.example.onion"));
  expect(url.origin).toBe("http://form.example.onion");
  expect(url.pathname).toBe(`/s/${REQUEST_SURVEYS["zh-CN"]}`);
});

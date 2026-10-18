import { expect, test } from "@playwright/test";
import { LOCALES, messagesOf } from "../../src/i18n/index.ts";
import { ONION_HOST } from "../../src/site.ts";
import { WISH_ENDPOINT, WISH_ENDPOINT_ONION, WISH_SURVEYS, wishPayload, wishReady } from "../../src/wish.ts";

const labelOf = (locale: (typeof LOCALES)[number]["id"]) => (key: string) => (messagesOf(locale) as Record<string, string>)[key]!;

test("許願區送出的內容：選項用該語系的文字，帶上工具、語系與版本", () => {
  const payload = wishPayload(
    { kind: "format", goal: "  想把手機的錄音轉成逐字稿  ", current: "", frequency: "weekly", contact: " me@example.com " },
    { tool: "transcribe", locale: "zh-TW", version: "2026.10.18 14:05 ba8342a" },
    labelOf("zh-TW"),
  );
  expect(payload).toEqual({
    surveyId: WISH_SURVEYS["zh-TW"],
    finished: true,
    data: {
      kind: "支援新的檔案格式",
      goal: "想把手機的錄音轉成逐字稿",
      frequency: "每週",
      contact: "me@example.com",
      tool: "transcribe",
      locale: "zh-TW",
      version: "2026.10.18 14:05 ba8342a",
    },
  });
});

test("許願區：沒填的欄位不送，桌面寫成 home，每個語系送到自己的問卷", () => {
  const payload = wishPayload({ kind: "other", goal: "一段夠長的說明文字", current: " ", contact: "" }, { tool: "", locale: "en", version: "v" }, labelOf("en"));
  expect(payload.surveyId).toBe(WISH_SURVEYS.en);
  expect(payload.data).toEqual({ kind: "Other", goal: "一段夠長的說明文字", tool: "home", locale: "en", version: "v" });
  expect(new Set(LOCALES.map((l) => WISH_SURVEYS[l.id])).size).toBe(LOCALES.length);
});

test("許願區：選了類型、想完成的事至少 10 個字才能送出", () => {
  expect(wishReady({ goal: "一段夠長的說明文字喔" })).toBe(false);
  expect(wishReady({ kind: "bug", goal: "太短了" })).toBe(false);
  expect(wishReady({ kind: "bug", goal: "          " })).toBe(false);
  expect(wishReady({ kind: "bug", goal: "一段夠長的說明文字喔" })).toBe(true);
});

test("許願區：clearnet 送到 form.anoni.net，onion 版送到 onion 的表單伺服器，都只開送出的路徑", () => {
  expect(WISH_ENDPOINT).toMatch(/^https:\/\/form\.anoni\.net\/api\/v1\/client\/[a-z0-9]+\/responses$/);
  expect(WISH_ENDPOINT_ONION).toBe(WISH_ENDPOINT.replace("https://form.anoni.net", `http://form.${ONION_HOST}`));
});

import { expect, test } from "@playwright/test";
import { localeOfLanguage, suggestLocale } from "../../src/i18n/suggest.ts";

test("瀏覽器的語言對應到介面的語系", () => {
  expect(localeOfLanguage("zh-TW")).toBe("zh-TW");
  expect(localeOfLanguage("zh-Hant-HK")).toBe("zh-TW");
  expect(localeOfLanguage("zh-HK")).toBe("zh-TW");
  expect(localeOfLanguage("zh-CN")).toBe("zh-CN");
  expect(localeOfLanguage("zh-Hans")).toBe("zh-CN");
  expect(localeOfLanguage("zh")).toBeNull();
  expect(localeOfLanguage("en-GB")).toBe("en");
  expect(localeOfLanguage("ja")).toBe("en");
});

test("清單裡有目前的語系就不建議，否則建議第一個認得的", () => {
  expect(suggestLocale(["en-US"], "zh-TW")).toBe("en");
  expect(suggestLocale(["en-US", "zh-TW"], "zh-TW")).toBeNull();
  expect(suggestLocale(["zh-TW"], "zh-TW")).toBeNull();
  expect(suggestLocale(["zh", "zh-CN"], "zh-TW")).toBe("zh-CN");
  expect(suggestLocale(["zh-TW", "en"], "en")).toBeNull();
  expect(suggestLocale(["zh-TW"], "en")).toBe("zh-TW");
  expect(suggestLocale(["zh"], "en")).toBeNull();
  expect(suggestLocale([], "zh-TW")).toBeNull();
});

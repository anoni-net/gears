import { expect, test } from "@playwright/test";
import { LOCALES, messagesOf } from "../../src/i18n/index.ts";
import { NOT_FOUND, labIds, pageIds } from "../../src/pages.ts";
import { staticContent } from "../../src/static-content.ts";
import { editorTools, fileTools, toolIds } from "../../src/tools/index.ts";

// 建置時寫進每一頁 HTML 的內容（src/static-content.ts，#164），給不執行 JavaScript 的搜尋引擎看

const zhTW = { messages: messagesOf("zh-TW") as Record<string, string>, home: "/gears/" };
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const h1 = (html: string) => [...html.matchAll(/<h1>([^<]*)<\/h1>/g)].map((m) => m[1]);

test("桌面列出每個工具與工具以外的頁面，實驗頁除外", () => {
  const html = staticContent("", zhTW);
  expect(h1(html)).toEqual(["anoni.net Gears 檔案工作台"]);
  // 跟畫面一樣先寫兩段定位說明（src/ui/DeskIntro.tsx）
  expect(html).toContain("<h2>瀏覽器裡就能完成</h2>");
  expect(html).toContain("<h2>用開源本機模型加強</h2>");
  const links = hrefs(html);
  for (const id of toolIds) expect(links, id).toContain(`/gears/${id}/`);
  for (const id of pageIds) {
    if (labIds.includes(id)) expect(links, id).not.toContain(`/gears/${id}/`);
    else expect(links, id).toContain(`/gears/${id}/`);
  }
});

test("工具頁的 h1 是工具名稱，附上使用方式與同一組的其他工具", () => {
  const html = staticContent("strip-metadata", zhTW);
  expect(h1(html)).toEqual(["清除中繼資料"]);
  expect(html).toContain("拿掉照片的拍攝位置與手機型號");
  expect(html).toContain("<h2>使用方式</h2><ol><li>");
  expect(html).toContain("<h2>交出去之前</h2>");
  expect(hrefs(html)).toContain("/gears/redact/");
  expect(hrefs(html)).not.toContain("/gears/strip-metadata/");
  expect(hrefs(html)).toContain("/gears/");
  // 從空白開始的工具也有使用方式（2026-11-22 起，AGENTS.md「設計語言」的骨架）
  expect(staticContent("qrcode", zhTW)).toContain("<h2>使用方式</h2><ol><li>");
});

test("每一頁都有一個 h1，網址跟著語系，找不到的頁面不寫內容", () => {
  for (const locale of LOCALES) {
    const options = { messages: messagesOf(locale.id) as Record<string, string>, home: `/gears/${locale.prefix}` };
    for (const id of ["", ...toolIds, ...pageIds]) {
      const html = staticContent(id, options);
      expect(h1(html).filter(Boolean), `${locale.id} ${id}`).toHaveLength(1);
      expect(html, `${locale.id} ${id}`).not.toMatch(/(tool|meta|desk|howto)\.[a-z]/);
      for (const href of hrefs(html)) expect(href, `${locale.id} ${id}`).toMatch(new RegExp(`^/gears/${locale.prefix}`));
    }
  }
  expect(staticContent(NOT_FOUND, zhTW)).toBe("");
});

test("字串裡的符號會跳脫", () => {
  const html = staticContent("", { ...zhTW, messages: { ...zhTW.messages, "meta.home.title": `<b>"&` } });
  expect(h1(html)).toEqual(["&lt;b&gt;&quot;&amp;"]);
});

// 搜尋結果的摘要大約顯示 160 個字元，英文的描述超過就會被截斷
test("英文的頁面描述不超過 160 個字元", () => {
  const en = messagesOf("en") as Record<string, string>;
  const long = Object.entries(en).filter(([key, value]) => /^meta\.[^.]+\.description$/.test(key) && value.length > 160);
  expect(long.map(([key, value]) => `${key} ${value.length}`)).toEqual([]);
});

// 首頁與處理檔案的工具，搜尋描述的前半段寫「檔案不用上傳」（#255，AGENTS.md 的「介面文字」）。
// 摘要放不下整段描述，寫在最後會被截掉。遠端傳送的檔案經過轉送服務，不在這份清單裡
test("首頁與處理檔案的工具的搜尋描述，前半段寫「檔案不用上傳」", () => {
  const PHRASE = { "zh-TW": ["檔案不用上傳", 65], "zh-CN": ["文件不用上传", 65], en: ["No upload needed", 120] } as const;
  const ids = ["home", ...fileTools.map((tool) => tool.id), ...editorTools.map((tool) => tool.id), "verify"];
  for (const { id: locale } of LOCALES) {
    const messages = messagesOf(locale) as Record<string, string>;
    const [phrase, within] = PHRASE[locale];
    const wrong = ids.filter((id) => {
      const at = messages[`meta.${id}.description`]!.indexOf(phrase);
      return at < 0 || at > within;
    });
    expect(wrong, locale).toEqual([]);
    expect(messages["meta.remote.description"], locale).not.toContain(phrase);
  }
});

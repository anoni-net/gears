import { expect, test } from "@playwright/test";
import { LOCALES, messagesOf } from "../../src/i18n/index.ts";
import { NOT_FOUND, labIds, pageIds } from "../../src/pages.ts";
import { staticContent } from "../../src/static-content.ts";
import { toolIds } from "../../src/tools/index.ts";

// 建置時寫進每一頁 HTML 的內容（src/static-content.ts，#164），給不執行 JavaScript 的搜尋引擎看

const zhTW = { messages: messagesOf("zh-TW") as Record<string, string>, home: "/gears/" };
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const h1 = (html: string) => [...html.matchAll(/<h1>([^<]*)<\/h1>/g)].map((m) => m[1]);

test("桌面列出每個工具與工具以外的頁面，實驗頁除外", () => {
  const html = staticContent("", zhTW);
  expect(h1(html)).toEqual(["anoni.net Gears 檔案工作台"]);
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
  // 從空白開始的工具沒有使用方式
  expect(staticContent("qrcode", zhTW)).not.toContain("使用方式");
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

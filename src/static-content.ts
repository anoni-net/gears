import { NOT_FOUND, labIds, pageIds } from "./pages.ts";
import { TOOL_GROUPS } from "./ui/tool-meta.ts";

// 建置時寫進每一頁 HTML 的內容（#164），由 vite.config.ts 的 localized 放進 <div id="app">。
// 工作台的畫面全靠 JavaScript 畫出來，原本的 HTML 只有 noscript 的一行，不執行 JavaScript 的搜尋引擎
// 與 AI 爬蟲看到的 90 頁內文都一樣，從桌面也找不到任何工具頁。這裡寫出這一頁的標題、說明、使用方式，
// 以及連到其他工具的連結，打開之後 src/main.tsx 清空、換成工作台。Tor Browser 最安全的等級關掉
// JavaScript，讀者看到的也是這一份。只用字串，不碰 DOM，單元測試在 Node 裡執行

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Options {
  // 這個語系的字串（src/i18n/ 的 messagesOf）
  messages: Record<string, string>;
  // 這個語系的首頁網址，例如 /gears/、/gears/en/，onion 版是 /、/en/
  home: string;
}

export function staticContent(id: string, { messages, home }: Options): string {
  if (id === NOT_FOUND) return "";
  const m = (key: string) => escape(messages[key] ?? "");
  const href = (target: string) => `${home}${target}/`;
  // 跟桌面一樣，名稱下面一行寫讀者會遇到的情況，不用標點接起來，三個語系共用
  const toolLink = (tool: string) => `<li><a href="${href(tool)}">${m(`tool.${tool}`)}</a><br>${m(`desk.when.${tool}`)}</li>`;
  const group = (g: (typeof TOOL_GROUPS)[number], skip?: string) =>
    [
      `<h2>${m(`desk.group.${g.id}`)}</h2>`,
      `<p>${m(`desk.group.${g.id}.desc`)}</p>`,
      `<ul>${g.tools
        .filter((tool) => tool !== skip)
        .map(toolLink)
        .join("")}</ul>`,
    ].join("");
  const back = `<p><a href="${home}">${m("app.home")}</a></p>`;

  let parts: string[];
  if (!id) {
    // 桌面：三組工具全部列出，接著是工具以外的頁面（實驗頁除外）
    parts = [
      `<h1>${m("meta.home.title")}</h1>`,
      `<p>${m("meta.home.description")}</p>`,
      ...TOOL_GROUPS.map((g) => group(g)),
      `<ul>${pageIds
        .filter((page) => !labIds.includes(page))
        .map((page) => `<li><a href="${href(page)}">${m(`${page}.title`)}</a></li>`)
        .join("")}</ul>`,
    ];
  } else if (pageIds.includes(id)) {
    parts = [`<h1>${m(`${id}.title`)}</h1>`, `<p>${m(`meta.${id}.description`)}</p>`, back];
  } else {
    // 工具：名稱、說明、處理檔案的工具另有三步的使用方式（howto.<id>.<n>），接著是同一組的其他工具
    const steps = [1, 2, 3].map((n) => messages[`howto.${id}.${n}`]).filter((step): step is string => !!step);
    const own = TOOL_GROUPS.find((g) => (g.tools as readonly string[]).includes(id));
    parts = [
      `<h1>${m(`tool.${id}`)}</h1>`,
      `<p>${m(`tool.${id}.desc`)}</p>`,
      ...(steps.length ? [`<h2>${m("intro.howto")}</h2>`, `<ol>${steps.map((step) => `<li>${escape(step)}</li>`).join("")}</ol>`] : []),
      ...(own ? [group(own, id)] : []),
      back,
    ];
  }
  return `<div class="frame static-page">${parts.join("")}</div>`;
}

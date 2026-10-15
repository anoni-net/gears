import { type Finding, type RunResult } from "../../core/tool.ts";
import { Tally } from "./package.ts";
import { other } from "./preview.ts";

// HTML。另存網頁時瀏覽器會在開頭加上「saved from url=」的註解，記著原本的網址；
// 編輯器與網站產生器留下 meta 標籤（作者、產生的軟體、描述、社群分享的網址與圖片）。
//
// 註解與不影響顯示的 meta 拿掉，script、style、textarea、title 裡的內容不動。
// 用 latin1 一個位元組對一個字元讀進來再寫回去，Big5 這類編碼的網頁不會被改壞。

// 影響顯示或安全的 meta 保留
const KEEP_NAMES = new Set(["viewport", "theme-color", "color-scheme", "supported-color-schemes", "referrer", "robots", "format-detection"]);
const KEEP_HTTP_EQUIV = new Set(["content-type", "content-security-policy", "x-ua-compatible", "content-language"]);

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const ATTR = /\b(name|property|http-equiv|charset|itemprop|content)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi;

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const toBytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
// 註解與 meta 的內容多半是 UTF-8，顯示時試著解開
const readable = (text: string) => new TextDecoder().decode(toBytes(text)).trim().slice(0, 120);

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(ATTR)) out[m[1]!.toLowerCase()] = m[2]!.replace(/^["']|["']$/g, "");
  return out;
}

function keepMeta(tag: string): boolean {
  const a = attrs(tag);
  if ("charset" in a) return true;
  if (a["http-equiv"] && KEEP_HTTP_EQUIV.has(a["http-equiv"].toLowerCase())) return true;
  return !!a.name && KEEP_NAMES.has(a.name.toLowerCase());
}

export function stripHtml(bytes: Uint8Array): RunResult {
  const tally = new Tally();
  const text = latin1(bytes).replace(TOKEN, (match, raw: string | undefined) => {
    if (raw) return match;
    if (match.startsWith("<!--")) {
      tally.add("comment");
      return "";
    }
    if (keepMeta(match)) return match;
    tally.add("html-meta");
    return "";
  });
  return { data: toBytes(text), report: { removed: tally.items(), kept: [{ code: "html-content" }] } };
}

export function inspectHtml(bytes: Uint8Array): Finding[] {
  const findings: Finding[] = [];
  for (const m of latin1(bytes).matchAll(TOKEN)) {
    const match = m[0];
    if (m[1]) continue;
    if (match.startsWith("<!--")) {
      const text = readable(match.replace(/^<!--|-->$/g, ""));
      const saved = /saved from url=\(\d+\)(\S+)/i.exec(text);
      findings.push(saved ? { code: "path", value: saved[1] } : { code: "comment", value: text || undefined });
      continue;
    }
    if (keepMeta(match)) continue;
    const a = attrs(match);
    const key = (a.name ?? a.property ?? a.itemprop ?? a["http-equiv"] ?? "").toLowerCase();
    const value = a.content ? readable(a.content) : undefined;
    if (key === "author" || key.endsWith(":author") || key === "dc.creator") findings.push({ code: "owner", value });
    else if (key === "generator") findings.push({ code: "software", value });
    else if (key === "description" || key === "keywords" || key.endsWith(":title") || key.endsWith(":description")) findings.push({ code: "text", value });
    else if (key.endsWith(":url")) findings.push({ code: "path", value });
    else findings.push(other(key || "meta", value));
  }
  return findings;
}

import { ToolError } from "./tool.ts";

// 小型的 XML 掃描器與改寫器。SVG、Office 與 ODF 的中繼資料都放在 XML 裡。
//
// 逐一讀出標籤，只改動規則指定的元素、屬性與文字，其餘的原樣照抄，縮排、屬性的順序
// 與引號都不變。不用 DOMParser 是為了讓工具在 Node 與 Web Worker 裡也能執行。

export interface XmlAttr {
  name: string;
  raw: string; // 前面的空白加上 name="value"
  value: string; // 原始的值，還沒有解開 &amp; 這類跳脫
}

export type XmlToken =
  | { kind: "text"; raw: string }
  | { kind: "comment"; raw: string }
  | { kind: "other"; raw: string } // XML 宣告、DOCTYPE、CDATA、處理指令
  | { kind: "open" | "close" | "empty"; raw: string; name: string; attrs: XmlAttr[] };

const NAME = /[^\s/>]+/y;
const SPACE = /\s*/y;
const ATTR = /([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/y;

export function tokenizeXml(text: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  let i = 0;
  const until = (marker: string, from: number) => {
    const end = text.indexOf(marker, from);
    if (end < 0) throw new ToolError("broken");
    return end + marker.length;
  };
  const match = (re: RegExp, at: number) => {
    re.lastIndex = at;
    return re.exec(text);
  };
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      tokens.push({ kind: "text", raw: text.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ kind: "text", raw: text.slice(i, lt) });
    if (text.startsWith("<!--", lt)) {
      const end = until("-->", lt + 4);
      tokens.push({ kind: "comment", raw: text.slice(lt, end) });
      i = end;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = until("]]>", lt);
      tokens.push({ kind: "other", raw: text.slice(lt, end) });
      i = end;
    } else if (text.startsWith("<?", lt)) {
      const end = until("?>", lt);
      tokens.push({ kind: "other", raw: text.slice(lt, end) });
      i = end;
    } else if (text.startsWith("<!", lt)) {
      // DOCTYPE，可能帶 [ ] 包起來的內部子集
      const bracket = text.indexOf("[", lt);
      const gt = text.indexOf(">", lt);
      const end = bracket >= 0 && bracket < gt ? until("]>", bracket) : until(">", lt);
      tokens.push({ kind: "other", raw: text.slice(lt, end) });
      i = end;
    } else {
      // 標籤：名稱接著屬性，屬性值用引號包起來，裡面可能有 >
      const closing = text[lt + 1] === "/";
      let j = lt + (closing ? 2 : 1);
      const nameMatch = match(NAME, j);
      if (!nameMatch) throw new ToolError("broken");
      const name = nameMatch[0];
      j += name.length;
      const attrs: XmlAttr[] = [];
      for (;;) {
        const ws = match(SPACE, j)![0];
        j += ws.length;
        if (j >= text.length) throw new ToolError("broken");
        if (text[j] === ">" || text.startsWith("/>", j)) break;
        const attr = match(ATTR, j);
        if (!attr) throw new ToolError("broken");
        attrs.push({ name: attr[1]!, raw: ws + attr[0], value: attr[2]!.slice(1, -1) });
        j += attr[0].length;
      }
      const empty = text.startsWith("/>", j);
      const end = j + (empty ? 2 : 1);
      tokens.push({ kind: closing ? "close" : empty ? "empty" : "open", raw: text.slice(lt, end), name, attrs });
      i = end;
    }
  }
  return tokens;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ToolError("unsupported");
  }
}

export const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export const unescapeXml = (text: string) =>
  text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (all, name: string) => {
    if (name[0] !== "#") return ENTITIES[name]!;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });

// 名稱解開命名空間之後的樣子。Office 與 ODF 的前綴是慣例不是規定，判斷時看命名空間
export interface XmlName {
  name: string;
  local: string;
  ns: string | null;
}

export interface XmlElement extends XmlName {
  attrs: (XmlName & { value: string })[]; // value 已經解開跳脫
  parents: XmlName[]; // 由外到內
}

export interface XmlRules {
  // 拿掉整個元素，連同裡面的內容
  dropElement?(el: XmlElement): boolean;
  // 改寫屬性：回傳 null 拿掉，回傳字串改成那個值，undefined 不動
  attr?(attr: XmlName & { value: string }, el: XmlElement): string | null | undefined;
  // 改寫元素裡直接的文字，回傳新的文字，undefined 不動
  text?(text: string, el: XmlElement): string | undefined;
  keepComments?: boolean;
}

export interface XmlRewrite {
  text: string;
  elements: number;
  attributes: number;
  texts: number;
  comments: number;
}

const XMLNS = "http://www.w3.org/2000/xmlns/";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

type Scope = Map<string, string>;

function declare(attrs: XmlAttr[], parent: Scope): Scope {
  const own = attrs.filter((a) => a.name === "xmlns" || a.name.startsWith("xmlns:"));
  if (!own.length) return parent;
  const scope = new Map(parent);
  for (const a of own) scope.set(a.name === "xmlns" ? "" : a.name.slice(6), unescapeXml(a.value));
  return scope;
}

function resolve(name: string, scope: Scope, isAttr: boolean): XmlName {
  const colon = name.indexOf(":");
  const prefix = colon < 0 ? "" : name.slice(0, colon);
  const local = colon < 0 ? name : name.slice(colon + 1);
  if (name === "xmlns" || prefix === "xmlns") return { name, local, ns: XMLNS };
  if (prefix === "xml") return { name, local, ns: XML_NS };
  // 沒有前綴的屬性不屬於任何命名空間，元素則套用預設的命名空間
  if (!prefix) return { name, local, ns: isAttr ? null : (scope.get("") ?? null) };
  return { name, local, ns: scope.get(prefix) ?? null };
}

function element(t: { name: string; attrs: XmlAttr[] }, scope: Scope, parents: XmlName[]): XmlElement {
  return {
    ...resolve(t.name, scope, false),
    attrs: t.attrs.map((a) => ({ ...resolve(a.name, scope, true), value: unescapeXml(a.value) })),
    parents,
  };
}

// 開頭與結尾的空白照抄，只改中間的內容
function replaceText(raw: string, value: string): string {
  const lead = /^\s*/.exec(raw)![0];
  const trail = /\s*$/.exec(raw.slice(lead.length))![0];
  return lead + escapeXml(value) + trail;
}

export function rewriteXml(source: string, rules: XmlRules): XmlRewrite {
  const tokens = tokenizeXml(source);
  const result: XmlRewrite = { text: "", elements: 0, attributes: 0, texts: 0, comments: 0 };
  const out: string[] = [];
  const stack: { el: XmlElement; scope: Scope }[] = [];
  let scope: Scope = new Map();
  let skipDepth = 0;
  for (const t of tokens) {
    if (t.kind === "open" || t.kind === "close" || t.kind === "empty") {
      if (skipDepth > 0) {
        if (t.kind === "open") skipDepth++;
        if (t.kind === "close") skipDepth--;
        continue;
      }
      if (t.kind === "close") {
        const top = stack.pop();
        if (!top || top.el.name !== t.name) throw new ToolError("broken");
        scope = stack.at(-1)?.scope ?? new Map();
        out.push(t.raw);
        continue;
      }
      const ownScope = declare(t.attrs, scope);
      const el = element(t, ownScope, stack.map((s) => s.el));
      if (rules.dropElement?.(el)) {
        result.elements++;
        if (t.kind === "open") skipDepth = 1;
        continue;
      }
      let changed = false;
      const attrs: string[] = [];
      t.attrs.forEach((a, i) => {
        const next = rules.attr?.(el.attrs[i]!, el);
        if (next === undefined || next === el.attrs[i]!.value) {
          attrs.push(a.raw);
          return;
        }
        changed = true;
        result.attributes++;
        if (next !== null) attrs.push(`${/^\s*/.exec(a.raw)![0]}${a.name}="${escapeXml(next)}"`);
      });
      out.push(changed ? `<${t.name}${attrs.join("")}${t.kind === "empty" ? "/>" : ">"}` : t.raw);
      if (t.kind === "open") {
        stack.push({ el, scope: ownScope });
        scope = ownScope;
      }
    } else if (skipDepth > 0) {
      continue;
    } else if (t.kind === "comment") {
      if (rules.keepComments) out.push(t.raw);
      else result.comments++;
    } else if (t.kind === "text" && stack.length && rules.text) {
      const raw = t.raw.trim();
      const next = raw ? rules.text(unescapeXml(raw), stack.at(-1)!.el) : undefined;
      if (next === undefined || next === unescapeXml(raw)) out.push(t.raw);
      else {
        result.texts++;
        out.push(replaceText(t.raw, next));
      }
    } else {
      out.push(t.raw);
    }
  }
  if (skipDepth > 0 || stack.length) throw new ToolError("broken");
  result.text = out.join("");
  return result;
}

// 逐一走過每個元素，檢查時用，不改寫
export function walkXml(source: string, visit: (el: XmlElement, text: string | null) => void) {
  const stack: { el: XmlElement; scope: Scope }[] = [];
  let scope: Scope = new Map();
  for (const t of tokenizeXml(source)) {
    if (t.kind === "close") {
      stack.pop();
      scope = stack.at(-1)?.scope ?? new Map();
    } else if (t.kind === "open" || t.kind === "empty") {
      const ownScope = declare(t.attrs, scope);
      const el = element(t, ownScope, stack.map((s) => s.el));
      visit(el, null);
      if (t.kind === "open") {
        stack.push({ el, scope: ownScope });
        scope = ownScope;
      }
    } else if (t.kind === "text" && stack.length) {
      const text = unescapeXml(t.raw).trim();
      if (text) visit(stack.at(-1)!.el, text);
    }
  }
}

import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";

// SVG 是文字檔。編輯器（Inkscape 等）會在裡面留下 <metadata>（作者、授權、RDF）、註解，
// 以及 inkscape:、sodipodi: 開頭的元素與屬性，其中 inkscape:export-filename、
// sodipodi:docname 常帶著電腦上的完整路徑與使用者名稱。
//
// 這裡用一個小型的掃描器逐一讀出標籤，拿掉上述內容，其餘的文字、樣式與圖形原樣保留。
// 不用 DOMParser 是為了讓工具在 Node 與 Web Worker 裡也能執行。

const EDITOR_PREFIXES = ["inkscape:", "sodipodi:"];
const UNUSED_NAMESPACES = ["xmlns:inkscape", "xmlns:sodipodi", "xmlns:dc", "xmlns:cc", "xmlns:rdf"];
const REMOVED_ELEMENTS = new Set(["metadata", "svg:metadata"]);

type Token =
  | { kind: "text"; raw: string }
  | { kind: "comment"; raw: string }
  | { kind: "other"; raw: string } // XML 宣告、DOCTYPE、CDATA、處理指令
  | { kind: "open" | "close" | "empty"; raw: string; name: string; attrs: { name: string; raw: string; value: string }[] };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const until = (marker: string, from: number) => {
    const end = text.indexOf(marker, from);
    if (end < 0) throw new ToolError("broken");
    return end + marker.length;
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
      const nameMatch = /^[^\s/>]+/.exec(text.slice(j, j + 256));
      if (!nameMatch) throw new ToolError("broken");
      const name = nameMatch[0];
      j += name.length;
      const attrs: { name: string; raw: string; value: string }[] = [];
      for (;;) {
        const ws = /^\s*/.exec(text.slice(j, j + 4096))![0];
        j += ws.length;
        if (j >= text.length) throw new ToolError("broken");
        if (text[j] === ">" || text.startsWith("/>", j)) break;
        const attr = /^([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/.exec(text.slice(j));
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

const isEditorName = (name: string) => EDITOR_PREFIXES.some((p) => name.startsWith(p));
const removedElement = (name: string) => REMOVED_ELEMENTS.has(name) || isEditorName(name);
const removedAttr = (name: string) => isEditorName(name) || UNUSED_NAMESPACES.includes(name);

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ToolError("unsupported");
  }
}

export function stripSvg(bytes: Uint8Array): RunResult {
  const text = decode(bytes);
  const tokens = tokenize(text);
  let out = "";
  let skipDepth = 0;
  let comments = 0;
  let elements = 0;
  let attributes = 0;
  for (const t of tokens) {
    if (t.kind === "open" || t.kind === "close" || t.kind === "empty") {
      if (skipDepth > 0) {
        if (t.kind === "open") skipDepth++;
        if (t.kind === "close") skipDepth--;
        continue;
      }
      if (t.kind !== "close" && removedElement(t.name)) {
        elements++;
        if (t.kind === "open") skipDepth = 1;
        continue;
      }
      if (t.kind === "close") {
        out += t.raw;
        continue;
      }
      const kept = t.attrs.filter((a) => !removedAttr(a.name));
      attributes += t.attrs.length - kept.length;
      out += kept.length === t.attrs.length ? t.raw : `<${t.name}${kept.map((a) => a.raw).join("")}${t.kind === "empty" ? "/>" : ">"}`;
    } else if (skipDepth > 0) {
      continue;
    } else if (t.kind === "comment") {
      comments++;
    } else {
      out += t.raw;
    }
  }
  if (skipDepth > 0) throw new ToolError("broken");
  const removed = [
    ...(elements ? [{ code: "svg-metadata" as const, count: elements }] : []),
    ...(attributes ? [{ code: "svg-editor" as const, count: attributes }] : []),
    ...(comments ? [{ code: "comment" as const, count: comments }] : []),
  ];
  return { data: new TextEncoder().encode(out), report: { removed, kept: [] } };
}

// 屬性值裡看起來像電腦路徑的（/home/…、C:\Users\…），整串列出來，讀者才知道洩漏了什麼
const PATH_LIKE = /^(\/|[A-Za-z]:\\|~)/;

export function inspectSvg(bytes: Uint8Array): Finding[] {
  let tokens: Token[];
  try {
    tokens = tokenize(decode(bytes));
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  let inMetadata = 0;
  for (const t of tokens) {
    if (t.kind === "comment") {
      const text = t.raw.slice(4, -3).trim().slice(0, 80);
      findings.push({ code: "comment", value: text || undefined });
      continue;
    }
    if (t.kind === "text" && inMetadata > 0) {
      const text = t.raw.trim();
      if (text) findings.push({ code: "owner", value: text.slice(0, 80) });
      continue;
    }
    if (t.kind !== "open" && t.kind !== "close" && t.kind !== "empty") continue;
    if (REMOVED_ELEMENTS.has(t.name)) {
      if (t.kind === "open") inMetadata++;
      if (t.kind === "close") inMetadata = Math.max(0, inMetadata - 1);
      findings.push({ code: "xmp" });
      continue;
    }
    if (t.kind === "close") continue;
    if (isEditorName(t.name)) findings.push({ code: "software", value: t.name.split(":")[0] });
    for (const a of t.attrs) {
      if (!isEditorName(a.name)) continue;
      if (PATH_LIKE.test(a.value)) findings.push({ code: "text", value: a.value.slice(0, 120) });
      else findings.push({ code: "software", value: a.name.split(":")[0] });
    }
  }
  return findings;
}

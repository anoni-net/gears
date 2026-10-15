import { type Finding, type RunResult } from "../../core/tool.ts";
import { type XmlToken, decodeUtf8, rewriteXml, tokenizeXml } from "../../core/xml.ts";

// SVG 是文字檔。編輯器（Inkscape 等）會在裡面留下 <metadata>（作者、授權、RDF）、註解，
// 以及 inkscape:、sodipodi: 開頭的元素與屬性，其中 inkscape:export-filename、
// sodipodi:docname 常帶著電腦上的完整路徑與使用者名稱。
//
// 用 src/core/xml.ts 的掃描器逐一讀出標籤，拿掉上述內容，其餘的文字、樣式與圖形原樣保留。

const EDITOR_PREFIXES = ["inkscape:", "sodipodi:"];
const UNUSED_NAMESPACES = ["xmlns:inkscape", "xmlns:sodipodi", "xmlns:dc", "xmlns:cc", "xmlns:rdf"];
const REMOVED_ELEMENTS = new Set(["metadata", "svg:metadata"]);

const isEditorName = (name: string) => EDITOR_PREFIXES.some((p) => name.startsWith(p));
const removedElement = (name: string) => REMOVED_ELEMENTS.has(name) || isEditorName(name);
const removedAttr = (name: string) => isEditorName(name) || UNUSED_NAMESPACES.includes(name);

export function stripSvg(bytes: Uint8Array): RunResult {
  const result = rewriteXml(decodeUtf8(bytes), {
    dropElement: (el) => removedElement(el.name),
    attr: (a) => (removedAttr(a.name) ? null : undefined),
  });
  const removed = [
    ...(result.elements ? [{ code: "svg-metadata" as const, count: result.elements }] : []),
    ...(result.attributes ? [{ code: "svg-editor" as const, count: result.attributes }] : []),
    ...(result.comments ? [{ code: "comment" as const, count: result.comments }] : []),
  ];
  return { data: new TextEncoder().encode(result.text), report: { removed, kept: [] } };
}

// 屬性值裡看起來像電腦路徑的（/home/…、C:\Users\…），整串列出來，讀者才知道洩漏了什麼
const PATH_LIKE = /^(\/|[A-Za-z]:\\|~)/;

export function inspectSvg(bytes: Uint8Array): Finding[] {
  let tokens: XmlToken[];
  try {
    tokens = tokenizeXml(decodeUtf8(bytes));
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
      if (PATH_LIKE.test(a.value)) findings.push({ code: "path", value: a.value.slice(0, 120) });
      else findings.push({ code: "software", value: a.name.split(":")[0] });
    }
  }
  return findings;
}

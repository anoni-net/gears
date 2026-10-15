import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { type XmlElement, type XmlName, rewriteXml, walkXml } from "../../core/xml.ts";
import { type Inner, type Part, Tally, inspectInner, partText, readParts, setText, stripInner, writeParts } from "./package.ts";

// EPUB 電子書：zip 裡是 XHTML 與一份 OPF，OPF 的 metadata 記錄作者、出版者、日期、識別碼，
// calibre 這類管理軟體會再加上自己的欄位。從 Apple Books 匯出的檔案還有 iTunesMetadata.plist，
// 裡面是購買者的帳號。
//
// metadata 只留書名、語言與識別碼（規定一定要有），識別碼換成隨機的 UUID，修改時間改成固定
// 的值。目錄（toc.ncx）的作者拿掉、識別碼跟著換。內文 XHTML 的 meta 與註解拿掉，圖片交給
// 對應格式的處理程式。
//
// 字型混淆（font obfuscation）用識別碼當鑰匙，有 encryption.xml 時識別碼不換，字型才讀得出來。
// 有 DRM（rights.xml 或其他加密方式）的電子書內容讀不到，不處理。

const NS = {
  opf: "http://www.idpf.org/2007/opf",
  dc: "http://purl.org/dc/elements/1.1/",
  ncx: "http://www.daisy.org/z3986/2005/ncx/",
  xhtml: "http://www.w3.org/1999/xhtml",
  container: "urn:oasis:names:tc:opendocument:xmlns:container",
  enc: "http://www.w3.org/2001/04/xmlenc#",
};

const FONT_OBFUSCATION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);
const REMOVED_PARTS = [/(^|\/)iTunesMetadata[^/]*\.plist$/, /(^|\/)calibre_bookmarks\.txt$/, /^META-INF\/signatures\.xml$/];
const KEPT_META = new Set(["viewport"]);
const NEUTRAL_MODIFIED = "2000-01-01T00:00:00Z";

const is = (n: XmlName, ns: keyof typeof NS, local?: string) => n.ns === NS[ns] && (local === undefined || n.local === local);
const attr = (el: XmlElement, name: string) => el.attrs.find((a) => a.name === name || a.local === name)?.value;

// 隨機的 UUID。crypto.randomUUID 只在 HTTPS 頁面可以用，這裡用 getRandomValues 自己組
function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function packagePath(parts: Part[]): string {
  const container = parts.find((p) => p.name === "META-INF/container.xml");
  if (!container) throw new ToolError("broken");
  let path = "";
  walkXml(partText(container), (el) => {
    if (!path && is(el, "container", "rootfile")) path = attr(el, "full-path") ?? "";
  });
  if (!path || !parts.some((p) => p.name === path)) throw new ToolError("broken");
  return path;
}

// 只有字型混淆時回傳 true；其他加密方式（DRM）不處理
function fontObfuscationOnly(parts: Part[]): boolean {
  if (parts.some((p) => p.name === "META-INF/rights.xml")) throw new ToolError("unsupported");
  const encryption = parts.find((p) => p.name === "META-INF/encryption.xml");
  if (!encryption) return false;
  walkXml(partText(encryption), (el) => {
    if (is(el, "enc", "EncryptionMethod") && !FONT_OBFUSCATION.has(attr(el, "Algorithm") ?? "")) throw new ToolError("unsupported");
  });
  return true;
}

const isXhtml = (name: string) => /\.x?html?$/i.test(name);

export async function stripEpub(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const all = await readParts(bytes);
  if (all[0]?.name !== "mimetype") throw new ToolError("broken");
  const keepIdentifier = fontObfuscationOnly(all);
  const opfPath = packagePath(all);
  const tally = new Tally();
  const parts = all.filter((p) => {
    const removed = REMOVED_PARTS.some((re) => re.test(p.name));
    if (removed) tally.add("doc-custom");
    return !removed;
  });

  const opf = parts.find((p) => p.name === opfPath)!;
  let uniqueId = "";
  walkXml(partText(opf), (el) => {
    if (is(el, "opf", "package")) uniqueId = attr(el, "unique-identifier") ?? "";
  });
  const identifier = keepIdentifier ? null : uuid();
  let newIdentifier: string | null = null;
  setText(
    opf,
    rewriteXml(partText(opf), {
      keepComments: false,
      dropElement(el) {
        const parent = el.parents.at(-1);
        if (!parent || !is(parent, "opf", "metadata")) return false;
        if (is(el, "dc", "title") || is(el, "dc", "language")) return false;
        if (is(el, "dc", "identifier") && attr(el, "id") === uniqueId) return false;
        if (is(el, "opf", "meta") && (attr(el, "property") === "dcterms:modified" || attr(el, "name") === "cover")) return false;
        tally.add("doc-properties");
        return true;
      },
      attr(a, el) {
        // dc:title 與 dc:language 上的 opf:file-as 這類屬性也可能帶名字，只留 id 與語言
        const parent = el.parents.at(-1);
        if (parent && is(parent, "opf", "metadata") && (is(el, "dc", "title") || is(el, "dc", "language")) && a.local !== "id" && a.name !== "xml:lang") return null;
        return undefined;
      },
      text(text, el) {
        if (is(el, "dc", "identifier") && identifier) {
          tally.add("doc-ids");
          newIdentifier = text;
          return identifier;
        }
        if (is(el, "opf", "meta") && attr(el, "property") === "dcterms:modified") return NEUTRAL_MODIFIED;
        return undefined;
      },
    }).text,
  );

  for (const part of parts) {
    if (part === opf) continue;
    if (part.name.endsWith(".ncx")) {
      setText(
        part,
        rewriteXml(partText(part), {
          dropElement: (el) => is(el, "ncx", "docAuthor"),
          attr: (a, el) => (identifier && newIdentifier !== null && is(el, "ncx", "meta") && attr(el, "name") === "dtb:uid" && a.name === "content" ? identifier : undefined),
        }).text,
      );
    } else if (isXhtml(part.name)) {
      const result = rewriteXml(partText(part), {
        keepComments: false,
        dropElement: (el) => is(el, "xhtml", "meta") && attr(el, "name") !== undefined && !KEPT_META.has(attr(el, "name")!.toLowerCase()),
      });
      if (result.elements || result.comments) tally.add("doc-custom");
      setText(part, result.text);
    }
  }

  const images = await stripInner(parts, inner, (p) => p.name === "mimetype" || /\.(x?html?|xml|opf|ncx|css)$/i.test(p.name));
  if (images) tally.add("doc-images");
  return { data: await writeParts(parts), report: { removed: tally.items(), kept: [{ code: "doc-content" }] } };
}

export async function inspectEpub(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const parts = await readParts(bytes);
  const opfPath = packagePath(parts);
  const findings: Finding[] = [];
  const names = new Set<string>();
  for (const part of parts) {
    if (REMOVED_PARTS.some((re) => re.test(part.name))) findings.push({ code: "other", value: part.name.split("/").at(-1) });
  }
  const opfText = partText(parts.find((p) => p.name === opfPath)!);
  let uniqueId = "";
  walkXml(opfText, (el) => {
    if (is(el, "opf", "package")) uniqueId = attr(el, "unique-identifier") ?? "";
  });
  walkXml(opfText, (el, text) => {
    const parent = el.parents.at(-1);
    if (!parent || !is(parent, "opf", "metadata")) return;
    if (text === null) {
      if (is(el, "opf", "meta") && attr(el, "name") && attr(el, "name") !== "cover") findings.push({ code: "other" });
      return;
    }
    if (is(el, "dc", "creator") || is(el, "dc", "contributor") || is(el, "dc", "publisher") || is(el, "dc", "rights")) names.add(text);
    else if (is(el, "dc", "date") || (is(el, "opf", "meta") && attr(el, "property") === "dcterms:modified" && text !== NEUTRAL_MODIFIED))
      findings.push({ code: "datetime", value: text });
    else if (is(el, "dc", "description")) findings.push({ code: "comment", value: text.slice(0, 80) });
    // 主要的識別碼規定要有，清除時換成隨機的，不列出來；其他的識別碼（ISBN、書店的編號）會拿掉
    else if (is(el, "dc", "identifier") && attr(el, "id") !== uniqueId) findings.push({ code: "other", value: text.slice(0, 80) });
    else if (is(el, "dc", "subject") || is(el, "dc", "source")) findings.push({ code: "text", value: text.slice(0, 80) });
  });
  for (const part of parts) {
    if (!isXhtml(part.name)) continue;
    walkXml(partText(part), (el, text) => {
      if (text === null && is(el, "xhtml", "meta") && attr(el, "name")?.toLowerCase() === "author") names.add(attr(el, "content") ?? "");
    });
  }
  names.delete("");
  if (names.size) findings.unshift({ code: "owner", value: [...names].slice(0, 5).join("、") });
  findings.push(...(await inspectInner(parts, inner, (p) => p.name === "mimetype" || /\.(x?html?|xml|opf|ncx|css)$/i.test(p.name))));
  return findings;
}

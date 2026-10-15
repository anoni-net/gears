import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { type XmlElement, type XmlName, rewriteXml, walkXml } from "../../core/xml.ts";
import {
  type Inner,
  NEUTRAL_AUTHOR,
  type Part,
  authorPrefix,
  Tally,
  inspectInner,
  isLocalPath,
  partText,
  readParts,
  setText,
  stripInner,
  writeParts,
} from "./package.ts";
import { other } from "./preview.ts";

// ODF 文件（odt、ods、odp、odg，LibreOffice 的預設格式）。zip 的第一個檔案是不壓縮的
// mimetype，META-INF/manifest.xml 列出每個檔案。
//
// 會透露身分的地方：
// - meta.xml：建立者、最後修改者、列印者、時間、編輯時數與次數、軟體版本、範本的路徑
// - settings.xml：印表機名稱與設定、連接的資料庫、rsid
// - Thumbnails/：第一頁的預覽圖
// - 註解與追蹤修訂的作者、時間與縮寫
// - 內文與樣式裡的 rsid（每次編輯工作階段一個識別碼）
// - 數位簽章、內嵌圖片自己的中繼資料
//
// 內嵌的物件（Object 1/ 這類目錄）也是一份 ODF，套用同樣的規則。

const NS = {
  office: "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
  meta: "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
  config: "urn:oasis:names:tc:opendocument:xmlns:config:1.0",
  manifest: "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0",
  officeooo: "http://openoffice.org/2009/office",
  dc: "http://purl.org/dc/elements/1.1/",
  xlink: "http://www.w3.org/1999/xlink",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  table: "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
};

const is = (n: XmlName, ns: keyof typeof NS, local?: string) => n.ns === NS[ns] && (local === undefined || n.local === local);

const REMOVED_PARTS = [/^Thumbnails\//, /^META-INF\/[^/]*signatures[^/]*\.xml$/];
const isRemoved = (name: string) => REMOVED_PARTS.some((re) => re.test(name));

// settings.xml 裡拿掉的設定。其他的（版面相容性、檢視）跟文件的樣子有關，保留
const PRINTER_ITEMS = new Set(["PrinterName", "PrinterSetup", "PrintFileName"]);
const DATABASE_ITEMS = new Set(["CurrentDatabaseDataSource", "CurrentDatabaseCommand", "CurrentDatabaseCommandType"]);
const ID_ITEMS = new Set(["RsidRoot", "Rsid"]);

// ODF 的時間沒有時區
const NEUTRAL_TIME = "1980-01-01T00:00:00";

const base = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const isXml = (name: string) => name.endsWith(".xml");
const configName = (el: XmlElement) => el.attrs.find((a) => is(a, "config", "name"))?.value ?? "";
const inAnnotation = (el: XmlElement) => el.parents.some((p) => p.local === "annotation");

function annotationAuthors(parts: Part[]): Set<string> {
  const authors = new Set<string>();
  for (const part of parts) {
    if (base(part.name) !== "content.xml") continue;
    walkXml(partText(part), (el, text) => {
      if (text && is(el, "dc", "creator") && inAnnotation(el)) authors.add(text);
    });
  }
  return authors;
}

function checkManifest(parts: Part[]) {
  const manifest = parts.find((p) => p.name === "META-INF/manifest.xml");
  if (!manifest) throw new ToolError("broken");
  // 加密的文件內容讀不到，沒辦法確認處理乾淨
  walkXml(partText(manifest), (el) => {
    if (is(el, "manifest", "encryption-data")) throw new ToolError("unsupported");
  });
  return manifest;
}

export async function stripOdf(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const all = await readParts(bytes);
  if (all[0]?.name !== "mimetype") throw new ToolError("broken");
  checkManifest(all);
  const tally = new Tally();
  const removed = new Set<string>();
  const { removeComments = false, acceptRevisions = false } = inner.options;
  for (const part of all) {
    if (!isRemoved(part.name)) continue;
    removed.add(part.name);
    tally.add(part.name.startsWith("Thumbnails/") ? "doc-thumbnail" : "doc-signature");
  }
  const parts = all.filter((p) => !removed.has(p.name));
  const authors = annotationAuthors(parts);

  for (const part of parts) {
    if (!isXml(part.name)) continue;
    const name = base(part.name);
    if (part.name === "META-INF/manifest.xml") {
      const result = rewriteXml(partText(part), {
        keepComments: true,
        dropElement: (el) =>
          is(el, "manifest", "file-entry") && removed.has(el.attrs.find((a) => is(a, "manifest", "full-path"))?.value ?? ""),
      });
      setText(part, result.text);
    } else if (name === "meta.xml") {
      // office:meta 底下的每一項都是描述資料，整個清空
      const result = rewriteXml(partText(part), {
        dropElement: (el) => el.parents.length > 0 && is(el.parents.at(-1)!, "office", "meta"),
      });
      if (result.elements) tally.add("doc-properties");
      setText(part, result.text);
    } else if (name === "settings.xml") {
      const result = rewriteXml(partText(part), {
        keepComments: true,
        dropElement(el) {
          if (!is(el, "config", "config-item")) return false;
          const item = configName(el);
          if (PRINTER_ITEMS.has(item)) tally.add("doc-printer");
          else if (DATABASE_ITEMS.has(item)) tally.add("doc-paths");
          else if (ID_ITEMS.has(item)) tally.add("doc-ids");
          else return false;
          return true;
        },
      });
      setText(part, result.text);
    } else {
      const result = rewriteXml(partText(part), {
        keepComments: true,
        dropElement(el) {
          // 讀者選擇刪除註解：註解本身與標示範圍結尾的 annotation-end
          if (removeComments && (el.local === "annotation" || el.local === "annotation-end") && (is(el, "office") || is(el, "officeooo"))) {
            tally.add("doc-comments-removed");
            return true;
          }
          // 讀者選擇接受修訂：刪除的內容都在 tracked-changes 裡，內文只有標記，插入的文字已經在內文裡
          if (acceptRevisions && ((el.local === "tracked-changes" && (is(el, "text") || is(el, "table"))) || (is(el, "text") && ["change", "change-start", "change-end"].includes(el.local)))) {
            tally.add("doc-revisions-accepted");
            return true;
          }
          // 註解的時間與縮寫可以拿掉。追蹤修訂的時間是必填，改成固定的值
          if ((is(el, "dc", "date") && inAnnotation(el)) || is(el, "meta", "creator-initials")) {
            tally.add("doc-authors");
            return true;
          }
          return false;
        },
        attr(a) {
          if (is(a, "officeooo") && a.local.endsWith("rsid")) {
            tally.add("doc-ids");
            return null;
          }
          return undefined;
        },
        text(text, el) {
          const next = is(el, "dc", "creator") ? NEUTRAL_AUTHOR : is(el, "dc", "date") ? NEUTRAL_TIME : undefined;
          if (next !== undefined && next !== text) tally.add("doc-authors");
          if (next === undefined && inAnnotation(el)) return authorPrefix(text, authors, () => tally.add("doc-authors"));
          return next;
        },
      });
      setText(part, result.text);
    }
  }

  const images = await stripInner(parts, inner, (p) => isXml(p.name) || p.name === "mimetype");
  if (images) tally.add("doc-images");

  return {
    data: await writeParts(parts),
    report: { removed: tally.items(), kept: [{ code: "doc-content" }] },
  };
}

export async function inspectOdf(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const parts = await readParts(bytes);
  checkManifest(parts);
  const findings: Finding[] = [];
  const names = new Set<string>();
  let comments = 0;
  let revisions = 0;

  for (const part of parts) {
    if (part.name.startsWith("Thumbnails/")) findings.push({ code: "thumbnail" });
    else if (/^META-INF\/[^/]*signatures/.test(part.name)) findings.push({ code: "signature" });
    if (!isXml(part.name) || part.name.startsWith("META-INF/")) continue;
    const name = base(part.name);
    walkXml(partText(part), (el, text) => {
      if (name === "meta.xml") {
        if (text === null) {
          if (is(el, "meta", "template")) {
            const href = el.attrs.find((a) => is(a, "xlink", "href"))?.value;
            if (href && isLocalPath(href)) findings.push({ code: "path", value: href.slice(0, 120) });
          }
          return;
        }
        if (is(el, "meta", "initial-creator") || is(el, "dc", "creator") || is(el, "meta", "printed-by")) names.add(text);
        else if (is(el, "meta", "creation-date") || is(el, "dc", "date") || is(el, "meta", "print-date"))
          findings.push({ code: "datetime", value: text });
        else if (is(el, "meta", "generator")) findings.push({ code: "software", value: text.slice(0, 80) });
        else if (is(el, "dc", "title") || is(el, "dc", "description") || is(el, "dc", "subject") || is(el, "meta", "keyword"))
          findings.push({ code: "text", value: text.slice(0, 80) });
        else if (is(el, "meta", "editing-duration")) findings.push(other("editing-duration", text));
        else if (is(el, "meta", "user-defined")) findings.push(other(el.attrs.find((a) => is(a, "meta", "name"))?.value ?? "user-defined", text));
        else if (is(el, "meta", "editing-cycles")) findings.push(other("editing-cycles", text));
        return;
      }
      if (name === "settings.xml") {
        if (text !== null && is(el, "config", "config-item")) {
          const item = configName(el);
          if (item === "PrinterName") findings.push({ code: "printer", value: text });
          else if (item === "CurrentDatabaseDataSource" || item === "RsidRoot") findings.push(other(item, text));
        }
        return;
      }
      if (text !== null) {
        if (is(el, "dc", "creator")) names.add(text);
        return;
      }
      if (el.local === "annotation" && (is(el, "office") || is(el, "officeooo"))) comments++;
      if (is(el, "office", "change-info") && !inAnnotation(el)) revisions++;
      const rsid = el.attrs.find((a) => is(a, "officeooo") && a.local.endsWith("rsid"));
      if (rsid) findings.push(other("rsid", rsid.value));
    });
  }

  names.delete(NEUTRAL_AUTHOR);
  if (names.size) findings.unshift({ code: "owner", value: [...names].slice(0, 5).join("、") });
  findings.push(...(await inspectInner(parts, inner, (p) => isXml(p.name) || p.name === "mimetype")));
  if (comments) findings.push({ code: "doc-comments" });
  if (revisions) findings.push({ code: "revisions" });
  return findings;
}

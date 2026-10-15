import { type Finding, type RunResult } from "../../core/tool.ts";
import { type XmlElement, type XmlName, type XmlRules, rewriteXml, walkXml } from "../../core/xml.ts";
import {
  type Inner,
  NEUTRAL_AUTHOR,
  NEUTRAL_TIME,
  type Part,
  authorPrefix,
  Tally,
  basename,
  inspectInner,
  isLocalPath,
  partText,
  readParts,
  setText,
  stripInner,
  writeParts,
} from "./package.ts";
import { other } from "./preview.ts";

// Office 文件（docx、xlsx、pptx，Office Open XML）。zip 裡是一組 XML，部件之間用
// .rels 檔裡的關聯互相指向，[Content_Types].xml 列出每個部件的類型。
//
// 會透露身分的地方：
// - docProps/core.xml、app.xml：作者、最後修改者、公司、主管、建立與修改時間、編輯時數、軟體版本
// - docProps/custom.xml、customXml/：自訂屬性，SharePoint 與企業的文件管理系統常寫在這裡
// - docProps/thumbnail.*：第一頁的預覽圖，可能是修改之前的樣子
// - 註解、追蹤修訂的作者與時間，people.xml、persons 裡的帳號
// - Word 的 rsid（每次編輯工作階段一個識別碼）與文件識別碼，可以用來比對同一台電腦產生的文件
// - 範本、合併列印來源與外部連結的路徑，常帶著電腦上的使用者名稱
// - 印表機設定（印表機的名稱）、Excel 記下的存檔路徑、敏感度標籤（組織的 ID）、數位簽章
// - 內嵌的圖片自己的中繼資料
//
// 這些拿掉或改寫，內文、格式與圖片的影像不動。註解與追蹤修訂是內容，保留下來，只把作者
// 改成中性的名字，檢查時另外提醒讀者。

const NS = {
  w: ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
  w14: ["http://schemas.microsoft.com/office/word/2010/wordml"],
  w15: ["http://schemas.microsoft.com/office/word/2012/wordml"],
  x: ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"],
  x15ac: ["http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"],
  xr: ["http://schemas.microsoft.com/office/spreadsheetml/2014/revision"],
  tc: ["http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"],
  p: ["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"],
  p15: ["http://schemas.microsoft.com/office/powerpoint/2012/main"],
  p188: ["http://schemas.microsoft.com/office/powerpoint/2018/8/main"],
  r: ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"],
  rel: ["http://schemas.openxmlformats.org/package/2006/relationships"],
  ct: ["http://schemas.openxmlformats.org/package/2006/content-types"],
  cp: ["http://schemas.openxmlformats.org/package/2006/metadata/core-properties"],
  dc: ["http://purl.org/dc/elements/1.1/"],
  dcterms: ["http://purl.org/dc/terms/"],
};

const is = (n: XmlName, ns: keyof typeof NS, local?: string) =>
  n.ns !== null && NS[ns].includes(n.ns) && (local === undefined || n.local === local);

// 整個拿掉的部件
const REMOVED_PARTS = [
  /^docProps\/custom\.xml$/,
  /^docProps\/thumbnail\.[^/]+$/,
  /^customXml\//,
  /^_xmlsignatures\//,
  /^\[trash\]\//,
  /^(word|xl|ppt)\/printerSettings\//,
  /^word\/people\.xml$/,
  /^docMetadata\//,
];

const segmentOf = (name: string) =>
  /^docProps\/thumbnail/.test(name)
    ? "doc-thumbnail"
    : /^_xmlsignatures\//.test(name)
      ? "doc-signature"
      : /printerSettings/.test(name)
        ? "doc-printer"
        : /people\.xml$/.test(name)
          ? "doc-authors"
          : "doc-custom";

const CORE_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>';
const APP_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"/>';

// .rels 檔屬於哪個部件：word/_rels/document.xml.rels 屬於 word/document.xml，_rels/.rels 屬於整個檔案
function relsSource(name: string): string | null {
  const m = /^(.*?)_rels\/([^/]*)\.rels$/.exec(name);
  return m ? m[1]! + m[2]! : null;
}

function resolveTarget(source: string, target: string): string {
  const path = target.startsWith("/") ? target.slice(1) : source.slice(0, source.lastIndexOf("/") + 1) + target;
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  let resolved = out.join("/");
  try {
    resolved = decodeURIComponent(resolved);
  } catch {
    // 照原樣
  }
  return resolved;
}

const isXml = (name: string) => /\.(xml|rels)$/i.test(name);
const isRemoved = (name: string) => REMOVED_PARTS.some((re) => re.test(name));

// 印表機設定是 Windows 的 DEVMODE 結構，開頭是 32 個 UTF-16 字元的印表機名稱
function printerName(data: Uint8Array): string | undefined {
  if (data.length < 64) return undefined;
  const name = new TextDecoder("utf-16le").decode(data.subarray(0, 64)).replace(/\0.*$/s, "").trim();
  // 不是 DEVMODE 的話讀出來是亂碼，不顯示
  return /^[\p{L}\p{N}][\p{L}\p{N} _\-.,()#@\\/]+$/u.test(name) ? name : undefined;
}

// XML 裡的文字與屬性值，給「其他欄位」顯示內容用
function xmlValues(text: string): string {
  const values: string[] = [];
  walkXml(text, (el, value) => {
    if (value !== null) values.push(value);
    else for (const a of el.attrs) if (!a.name.startsWith("xmlns") && a.local !== "fmtid" && a.local !== "pid") values.push(`${a.local}=${a.value}`);
  });
  return values.join(" ");
}

// 各部件的改寫規則。authors 是 Excel 註解的作者，舊版的 Excel 會把作者名字寫進註解內文的開頭
function rules(tally: Tally, removedIds: Set<string>, authors: Set<string>): XmlRules {
  const drop = (el: XmlElement) => {
    if (is(el, "w", "rsids") || is(el, "w", "rsid") || is(el, "w14", "docId") || is(el, "w15", "docId") || is(el, "xr", "revisionPtr")) {
      tally.add("doc-ids");
      return true;
    }
    if (is(el, "w", "attachedTemplate") || is(el, "w", "mailMerge")) {
      tally.add("doc-template");
      return true;
    }
    if (is(el, "w", "docVars")) {
      tally.add("doc-custom");
      return true;
    }
    if (is(el, "x15ac", "absPath")) {
      tally.add("doc-paths");
      return true;
    }
    if (is(el, "w15", "presenceInfo") || is(el, "p15", "presenceInfo")) {
      tally.add("doc-authors");
      return true;
    }
    return false;
  };

  const set = (value: string, next: string) => {
    if (value !== next) tally.add("doc-authors");
    return next;
  };
  const author = (value: string) => set(value, NEUTRAL_AUTHOR);
  const remove = () => {
    tally.add("doc-authors");
    return null;
  };

  return {
    keepComments: true,
    dropElement: drop,
    attr(a, el) {
      // 被拿掉的部件，指向它的 r:id 一併拿掉
      if (is(a, "r") && removedIds.has(a.value)) return null;
      if (is(a, "w") && a.local.startsWith("rsid")) {
        tally.add("doc-ids");
        return null;
      }
      if (a.local === "dateUtc") return remove();
      if (is(a, "w", "author") || is(a, "w15", "author")) return author(a.value);
      if (is(a, "w", "date") || is(a, "w", "initials")) return remove();
      if (a.ns !== null) return undefined;
      // 以下是沒有前綴的屬性，看它所屬的元素
      // 共用活頁簿的使用者、修訂紀錄與樞紐分析表最後重新整理的人
      if (is(el, "x") && (a.local === "userName" || a.local === "refreshedBy" || (el.local === "userInfo" && a.local === "name")))
        return author(a.value);
      if (is(el, "x") && a.local === "dateTime") return set(a.value, NEUTRAL_TIME);
      if (is(el, "x", "pivotCacheDefinition") && a.local.startsWith("refreshedDate")) return remove();
      if (is(el, "x") && (a.local === "odcFile" || a.local === "sourceFile") && isLocalPath(a.value)) {
        tally.add("doc-paths");
        return basename(a.value);
      }
      if (is(el, "tc", "threadedComment") && a.local === "dT") return remove();
      if (is(el, "tc", "person")) {
        if (a.local === "displayName" || a.local === "userId") return author(a.value);
        if (a.local === "providerId") return set(a.value, "None");
      }
      if (is(el, "p", "cmAuthor") || is(el, "p188", "author")) {
        if (a.local === "name" || a.local === "userId") return author(a.value);
        if (a.local === "initials") return set(a.value, "A");
        if (a.local === "providerId") return set(a.value, "None");
      }
      if (is(el, "p", "cm") && a.local === "dt") return remove();
      if (is(el, "p188") && a.local === "created") return set(a.value, NEUTRAL_TIME);
      return undefined;
    },
    text(text, el) {
      if (is(el, "x", "author") && el.parents.at(-1)?.local === "authors") return author(text);
      if (is(el, "x", "t")) return authorPrefix(text, authors, () => tally.add("doc-authors"));
      return undefined;
    },
  };
}

function excelAuthors(parts: Part[]): Set<string> {
  const authors = new Set<string>();
  for (const part of parts) {
    if (!/^xl\/comments.*\.xml$/.test(part.name)) continue;
    walkXml(partText(part), (el, text) => {
      if (text && is(el, "x", "author")) authors.add(text);
    });
  }
  return authors;
}

const isMediaPart = (part: Part) => !isXml(part.name) && !/\.rels$/.test(part.name);

export async function stripOoxml(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const all = await readParts(bytes);
  const tally = new Tally();
  const removed = new Set<string>();
  for (const part of all) {
    if (!isRemoved(part.name)) continue;
    removed.add(part.name);
    tally.add(segmentOf(part.name));
  }
  const parts = all.filter((p) => !removed.has(p.name));

  // 關聯：指向拿掉的部件的拿掉，外部連結的路徑只留檔名，範本與合併列印來源整個拿掉
  const removedIds = new Map<string, Set<string>>();
  for (const part of parts) {
    const source = relsSource(part.name);
    if (source === null) continue;
    const ids = new Set<string>();
    const result = rewriteXml(partText(part), {
      keepComments: true,
      dropElement(el) {
        if (!is(el, "rel", "Relationship")) return false;
        const get = (name: string) => el.attrs.find((a) => a.name === name)?.value ?? "";
        const external = get("TargetMode") === "External";
        const type = get("Type");
        const gone =
          (external && /\/(attachedTemplate|mailMergeSource|mailMergeHeaderSource|recipientData)$/.test(type)) ||
          (!external && removed.has(resolveTarget(source, get("Target"))));
        if (gone) {
          ids.add(get("Id"));
          if (external) tally.add("doc-template");
        }
        return gone;
      },
      attr(a, el) {
        if (a.name !== "Target" || el.attrs.find((x) => x.name === "TargetMode")?.value !== "External") return undefined;
        if (!isLocalPath(a.value)) return undefined;
        tally.add("doc-paths");
        return basename(a.value);
      },
    });
    setText(part, result.text);
    if (ids.size) removedIds.set(source, ids);
  }

  // [Content_Types].xml 裡拿掉的部件
  const types = parts.find((p) => p.name === "[Content_Types].xml");
  if (types) {
    setText(
      types,
      rewriteXml(partText(types), {
        keepComments: true,
        dropElement: (el) =>
          is(el, "ct", "Override") && removed.has(resolveTarget("", el.attrs.find((a) => a.name === "PartName")?.value ?? "")),
      }).text,
    );
  }

  const authors = excelAuthors(parts);
  for (const part of parts) {
    if (part.name === "docProps/core.xml") {
      setText(part, CORE_XML);
      tally.add("doc-properties");
    } else if (part.name === "docProps/app.xml") {
      setText(part, APP_XML);
      tally.add("doc-properties");
    } else if (isXml(part.name) && relsSource(part.name) === null && part.name !== "[Content_Types].xml") {
      setText(part, rewriteXml(partText(part), rules(tally, removedIds.get(part.name) ?? new Set(), authors)).text);
    }
  }

  const images = await stripInner(parts, inner, (p) => !isMediaPart(p));
  if (images) tally.add("doc-images");

  return {
    data: await writeParts(parts),
    report: { removed: tally.items(), kept: [{ code: "doc-content" }] },
  };
}

export async function inspectOoxml(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const parts = await readParts(bytes);
  const findings: Finding[] = [];
  const names = new Set<string>();
  let comments = 0;
  let revisions = 0;
  const attachments: string[] = [];

  for (const part of parts) {
    const { name } = part;
    if (/^docProps\/thumbnail/.test(name)) findings.push({ code: "thumbnail" });
    else if (/^_xmlsignatures\/.*\.xml$/.test(name)) findings.push({ code: "signature" });
    else if (/printerSettings\/.*\.bin$/.test(name)) findings.push({ code: "printer", value: printerName(part.data) });
    else if (/^docProps\/custom\.xml$|^customXml\/item\d*\.xml$|^docMetadata\//.test(name))
      // 自訂屬性與敏感度標籤（裡面有組織的 ID）：只顯示文字與屬性值，不顯示 XML 標籤
      findings.push(other(name.split("/").at(-1)!, xmlValues(partText(part))));
    else if (/\/embeddings\//.test(name)) {
      // 內嵌的 Office 文件一起檢查，其他內嵌物件（OLE）沒有辦法檢查，列出來提醒讀者
      const inside = await inner.inspect(part.data);
      if (inside) findings.push(...inside);
      else attachments.push(name.split("/").at(-1)!);
    }
  }

  for (const part of parts) {
    if (!isXml(part.name)) continue;
    const source = relsSource(part.name);
    walkXml(partText(part), (el, text) => {
      if (text !== null) {
        if (part.name === "docProps/core.xml") {
          if (is(el, "dc", "creator") || is(el, "cp", "lastModifiedBy")) names.add(text);
          else if (is(el, "dcterms", "created") || is(el, "dcterms", "modified") || is(el, "cp", "lastPrinted"))
            findings.push({ code: "datetime", value: text });
          else if (is(el, "dc", "title") || is(el, "dc", "subject") || is(el, "dc", "description") || is(el, "cp", "keywords"))
            findings.push({ code: "text", value: text.slice(0, 80) });
        } else if (part.name === "docProps/app.xml") {
          if (el.local === "Application") findings.push({ code: "software", value: text });
          else if (el.local === "Company" || el.local === "Manager") names.add(text);
          else if (el.local === "TotalTime" && text !== "0") findings.push(other("TotalTime", text));
        } else if (is(el, "x", "author")) names.add(text);
        return;
      }
      if (source !== null) {
        if (is(el, "rel", "Relationship")) {
          const target = el.attrs.find((a) => a.name === "Target")?.value ?? "";
          if (el.attrs.some((a) => a.name === "TargetMode" && a.value === "External") && isLocalPath(target))
            findings.push({ code: "path", value: target.slice(0, 120) });
        }
        return;
      }
      if (is(el, "w", "comment") || is(el, "p", "cm") || is(el, "p188", "cm") || is(el, "x", "comment")) comments++;
      if (is(el, "w", "ins") || is(el, "w", "del") || is(el, "w", "moveFrom") || is(el, "w", "moveTo")) revisions++;
      if (is(el, "w", "rsidRoot") || is(el, "w14", "docId") || is(el, "w15", "docId") || is(el, "xr", "revisionPtr"))
        findings.push(other(el.local, el.attrs.filter((a) => a.ns !== "http://www.w3.org/2000/xmlns/").map((a) => a.value).join(" ")));
      if (is(el, "x15ac", "absPath")) {
        const url = el.attrs.find((a) => a.local === "url")?.value;
        if (url) findings.push({ code: "path", value: url });
      }
      for (const a of el.attrs) {
        if (is(a, "w", "author") || is(a, "w15", "author")) names.add(a.value);
        else if ((is(el, "p", "cmAuthor") || is(el, "p188", "author")) && a.local === "name") names.add(a.value);
        else if (is(el, "tc", "person") && a.local === "displayName") names.add(a.value);
        else if (is(el, "x", "fileSharing") && a.local === "userName") names.add(a.value);
      }
    });
  }

  names.delete(NEUTRAL_AUTHOR);
  if (names.size) findings.unshift({ code: "owner", value: [...names].slice(0, 5).join("、") });
  findings.push(...(await inspectInner(parts, inner, (p) => !isMediaPart(p) || /\/embeddings\//.test(p.name))));
  if (comments) findings.push({ code: "doc-comments" });
  if (revisions) findings.push({ code: "revisions" });
  if (attachments.length) findings.push({ code: "attachments", value: attachments.slice(0, 5).join("、") });
  return findings;
}

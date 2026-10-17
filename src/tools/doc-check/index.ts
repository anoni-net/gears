import type { Format } from "../../core/bytes.ts";
import { decodeUtf8, walkXml } from "../../core/xml.ts";
import { readParts } from "../strip-metadata/package.ts";
import type * as PdfLib from "../strip-metadata/pdf-lib.ts";

// 收到的文件打開時會不會連到外面、執行程式。有些 Word 與 PDF 被做成一打開就連到寄件人的伺服器
// （遠端範本、外部圖片、開啟時執行的動作），對方就知道誰在什麼時候、從哪個 IP 打開。
//
// 只讀檔案的結構，不打開、不執行、不連線。列出的是檔案裡寫了什麼，實際會不會連線還要看打開的
// 軟體與設定（例如 Office 的保護檢視會先擋下外部內容），畫面上寫明。

export type CheckKind =
  | "connect" // 打開時就會連線（或要讀者確認之後連線）
  | "code" // 會執行的程式：巨集、JavaScript、DDE、ActiveX、開啟其他程式
  | "link" // 點了才會連的連結
  | "embedded"; // 內嵌的檔案與物件

export type CheckCode =
  | "remote-template"
  | "remote-image"
  | "remote-frame"
  | "remote-object"
  | "remote-data"
  | "remote-field"
  | "remote-style"
  | "remote-other"
  | "open-uri"
  | "macro"
  | "activex"
  | "dde"
  | "script-event"
  | "javascript"
  | "launch"
  | "xfa"
  | "hyperlink"
  | "submit-form"
  | "embedded-file"
  | "embedded-object";

export interface CheckItem {
  kind: CheckKind;
  code: CheckCode;
  url?: string; // 連到哪裡，從 JavaScript 裡找到的網址也放這裡
  name?: string; // 內嵌檔案的名稱、巨集的位置
}

export interface DocCheck {
  items: CheckItem[];
  partial?: "encrypted" | "broken"; // 有部分內容讀不到
}

export const CHECK_FORMATS: readonly Format[] = ["docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "odt", "ods", "odp", "odg", "pdf", "html", "svg"];

// 會連到別台電腦的位址。mailto、站內的 # 錨點與相對路徑不算
export function remoteTarget(target: string): string | null {
  const t = target.trim();
  if (/^(https?|ftp|ftps|wss?):\/\//i.test(t) || t.startsWith("\\\\") || /^file:\/\/[^/]/i.test(t)) return t;
  if (/^\/\/[^/]/.test(t)) return `https:${t}`; // 協定相對的網址
  return null;
}

// Windows 的網路芳鄰路徑（\\主機\分享），打開時 Windows 會自動送出帳號的驗證資訊
export const isUnc = (url: string) => url.startsWith("\\\\") || /^file:\/\/[^/]/i.test(url);

// 從程式碼與欄位指令裡找出網址與網路芳鄰路徑。Word 的欄位指令裡反斜線寫成兩個
// （\\\\主機\\分享），開頭是四個反斜線的就把每兩個收成一個
export function urlsIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:https?|ftp):\/\/[^\s"'<>()\\]+|\\{2,4}[A-Za-z0-9._-]+(?:\\{1,2}[^\s"'<>\\]+)*/gi)) {
    let url = m[0];
    if (url.startsWith("\\\\\\\\")) url = url.replace(/\\\\/g, "\\");
    found.add(url.replace(/[.,;]+$/, ""));
  }
  return [...found];
}

class Collector {
  readonly items: CheckItem[] = [];
  private seen = new Set<string>();
  add(item: CheckItem) {
    const key = `${item.kind}|${item.code}|${item.url ?? ""}|${item.name ?? ""}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push(item);
  }
}

export async function checkDocument(bytes: Uint8Array, format: Format): Promise<DocCheck> {
  if (format === "pdf") return checkPdf(bytes);
  if (format === "html" || format === "svg") return checkMarkup(decodeUtf8(bytes), format);
  if (["docx", "xlsx", "pptx", "docm", "xlsm", "pptm"].includes(format)) return checkOoxml(bytes);
  if (["odt", "ods", "odp", "odg"].includes(format)) return checkOdf(bytes);
  return { items: [] };
}

// ── Office（OOXML）─────────────────────────────────────────────────────────

// 外部關聯的類型（Relationship 的 Type 最後一段）對應打開時的行為
const OOXML_REL: Record<string, CheckCode> = {
  attachedTemplate: "remote-template",
  image: "remote-image",
  frame: "remote-frame",
  oleObject: "remote-object",
  externalLinkPath: "remote-data",
  externalLink: "remote-data",
  mailMergeSource: "remote-data",
  mailMergeHeaderSource: "remote-data",
  recipientData: "remote-data",
  subDocument: "remote-object",
  package: "remote-object",
  video: "remote-object",
  audio: "remote-object",
};

// Word 的欄位：INCLUDEPICTURE、INCLUDETEXT、LINK 指到網址時，打開或更新欄位就會去抓
const FIELD_REMOTE = /^\s*(INCLUDEPICTURE|INCLUDETEXT|LINK|IMPORT)\b/i;
const FIELD_DDE = /^\s*(DDEAUTO|DDE)\b/i;

async function checkOoxml(bytes: Uint8Array): Promise<DocCheck> {
  const out = new Collector();
  let parts;
  try {
    parts = await readParts(bytes);
  } catch {
    return { items: [], partial: "broken" };
  }
  for (const part of parts) {
    const name = part.name;
    if (/(^|\/)vbaProject\.bin$/i.test(name) || /vbaData\.xml$/i.test(name)) out.add({ kind: "code", code: "macro", name });
    if (/(^|\/)activeX\/activeX\d*\.(xml|bin)$/i.test(name)) out.add({ kind: "code", code: "activex", name });
    if (/(^|\/)embeddings\//i.test(name)) out.add({ kind: "embedded", code: "embedded-object", name: name.split("/").at(-1) });
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const text = decodeUtf8(part.data);
    // 欄位指令可能被拆成好幾個 instrText，同一段落裡接起來再判斷
    let instr = "";
    const flushField = () => {
      if (FIELD_DDE.test(instr)) out.add({ kind: "code", code: "dde", name: instr.trim().slice(0, 120) });
      else if (FIELD_REMOTE.test(instr)) for (const url of urlsIn(instr)) out.add({ kind: "connect", code: "remote-field", url });
      instr = "";
    };
    walkXml(text, (el, value) => {
      if (value !== null) {
        if (el.local === "instrText") instr += value;
        return;
      }
      if (el.local === "fldChar" && el.attrs.some((a) => a.local === "fldCharType" && a.value === "end")) flushField();
      if (el.local === "fldSimple") {
        const v = el.attrs.find((a) => a.local === "instr")?.value ?? "";
        instr = v;
        flushField();
      }
      if (el.local === "Relationship") {
        const get = (n: string) => el.attrs.find((a) => a.local === n)?.value ?? "";
        if (get("TargetMode") !== "External") return;
        const url = remoteTarget(get("Target"));
        if (!url) return;
        const type = get("Type").split("/").at(-1) ?? "";
        if (type === "hyperlink") out.add({ kind: "link", code: "hyperlink", url });
        else out.add({ kind: "connect", code: OOXML_REL[type] ?? "remote-other", url });
      }
      // Excel 的資料連線（connections.xml）：網頁查詢與資料庫連線
      if (el.local === "webPr") {
        const url = remoteTarget(el.attrs.find((a) => a.local === "url")?.value ?? "");
        if (url) out.add({ kind: "connect", code: "remote-data", url });
      }
      if (el.local === "dbPr") {
        const conn = el.attrs.find((a) => a.local === "connection")?.value ?? "";
        for (const url of urlsIn(conn)) out.add({ kind: "connect", code: "remote-data", url });
      }
    });
    flushField();
  }
  return { items: out.items };
}

// ── LibreOffice（ODF）──────────────────────────────────────────────────────

async function checkOdf(bytes: Uint8Array): Promise<DocCheck> {
  const out = new Collector();
  let parts;
  try {
    parts = await readParts(bytes);
  } catch {
    return { items: [], partial: "broken" };
  }
  for (const part of parts) {
    const name = part.name;
    if (/^(Basic|Scripts)\//.test(name) && !/\/$/.test(name)) out.add({ kind: "code", code: "macro", name: name.split("/").slice(0, 2).join("/") });
    if (/^Object \d+\//.test(name) && name.endsWith("content.xml")) out.add({ kind: "embedded", code: "embedded-object", name: name.split("/")[0] });
    if (!/\.xml$/i.test(name)) continue;
    walkXml(decodeUtf8(part.data), (el, value) => {
      if (value !== null) return;
      const href = el.attrs.find((a) => a.local === "href")?.value;
      const url = href ? remoteTarget(href) : null;
      if (url) {
        if (el.local === "a") out.add({ kind: "link", code: "hyperlink", url });
        else if (el.local === "image") out.add({ kind: "connect", code: "remote-image", url });
        else if (el.local === "object" || el.local === "object-ole" || el.local === "plugin") out.add({ kind: "connect", code: "remote-object", url });
        else if (el.local === "table-source" || el.local === "section-source") out.add({ kind: "connect", code: "remote-data", url });
        else if (el.local === "event-listener") out.add({ kind: "code", code: "script-event", url });
        else out.add({ kind: "connect", code: "remote-other", url });
      }
      // 文件事件（例如打開時）綁定的巨集或程式
      if (el.local === "event-listener" && !url) {
        const event = el.attrs.find((a) => a.local === "event-name")?.value ?? "";
        const macro = el.attrs.find((a) => a.local === "macro-name")?.value ?? href ?? "";
        out.add({ kind: "code", code: "script-event", name: `${event} ${macro}`.trim().slice(0, 120) });
      }
      if (el.local === "dde-connection-decl" || el.local === "dde-source") {
        const app = el.attrs.find((a) => a.local === "dde-application")?.value ?? "";
        const topic = el.attrs.find((a) => a.local === "dde-topic")?.value ?? "";
        out.add({ kind: "code", code: "dde", name: `${app} ${topic}`.trim() });
      }
    });
  }
  return { items: out.items };
}

// ── HTML 與 SVG ────────────────────────────────────────────────────────────

// HTML 顯示時會去載入的外部位址（圖片、樣式、頁框）。信件檢查用來找出內文的追蹤圖片
export function remoteResources(html: string): string[] {
  return checkMarkup(html, "html").items.flatMap((i) => (i.kind === "connect" && i.url ? [i.url] : []));
}

const MARKUP_CONNECT: Record<string, CheckCode> = {
  img: "remote-image",
  image: "remote-image",
  source: "remote-image",
  video: "remote-object",
  audio: "remote-object",
  iframe: "remote-frame",
  frame: "remote-frame",
  embed: "remote-object",
  object: "remote-object",
  link: "remote-style",
  use: "remote-image",
  feImage: "remote-image",
};

function checkMarkup(text: string, format: Format): DocCheck {
  const out = new Collector();
  // 不用完整的 HTML 解析器：抓出標籤與屬性就夠判斷，script 與 style 的內容另外看
  for (const m of text.matchAll(/<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g)) {
    const tag = m[1]!.toLowerCase();
    const local = tag.split(":").at(-1)!;
    const attrs = new Map<string, string>();
    for (const a of m[2]!.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs.set(a[1]!.toLowerCase(), a[2] ?? a[3] ?? a[4] ?? "");
    }
    const src = attrs.get("src") ?? attrs.get("href") ?? attrs.get("xlink:href") ?? attrs.get("data") ?? attrs.get("poster") ?? "";
    const url = remoteTarget(src);
    if (local === "script") {
      out.add({ kind: "code", code: "javascript", url: url ?? undefined });
      continue;
    }
    if (local === "a") {
      if (url) out.add({ kind: "link", code: "hyperlink", url });
      continue;
    }
    if (local === "form") {
      const action = remoteTarget(attrs.get("action") ?? "");
      if (action) out.add({ kind: "link", code: "submit-form", url: action });
      continue;
    }
    if (local === "meta" && /refresh/i.test(attrs.get("http-equiv") ?? "")) {
      for (const u of urlsIn(attrs.get("content") ?? "")) out.add({ kind: "connect", code: "open-uri", url: u });
      continue;
    }
    if (local === "link" && !/stylesheet|icon|preload|prefetch|manifest/i.test(attrs.get("rel") ?? "")) continue;
    if (url) out.add({ kind: "connect", code: MARKUP_CONNECT[local] ?? "remote-other", url });
    for (const s of (attrs.get("srcset") ?? "").split(",")) {
      const u = remoteTarget(s.trim().split(/\s+/)[0] ?? "");
      if (u) out.add({ kind: "connect", code: "remote-image", url: u });
    }
    // onload、onclick 這類屬性裡的程式
    if ([...attrs.keys()].some((k) => /^on[a-z]+$/.test(k))) out.add({ kind: "code", code: "javascript", name: `<${tag}>` });
  }
  // CSS 的 url() 與 @import
  for (const m of text.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^"')\s]+)/gi)) {
    const url = remoteTarget(m[1]!);
    if (url) out.add({ kind: "connect", code: format === "svg" ? "remote-image" : "remote-style", url });
  }
  return { items: out.items };
}

// ── PDF ────────────────────────────────────────────────────────────────────

type Lib = typeof PdfLib;
type Trigger = "open" | "click";

// 頁面與註解的觸發時機：O 是打開頁面、PO/PV 是頁面打開或看得到時，這些不需要讀者操作
const AUTO_TRIGGERS = new Set(["O", "PO", "PV", "WC", "WS", "DS", "WP", "DP"]);

async function checkPdf(bytes: Uint8Array): Promise<DocCheck> {
  try {
    return await walkPdf(bytes);
  } catch {
    // 結構壞掉的 PDF（例如沒有文件目錄），pdf-lib 讀得進來但走不下去
    return { items: [], partial: "broken" };
  }
}

async function walkPdf(bytes: Uint8Array): Promise<DocCheck> {
  const lib = await import("../strip-metadata/pdf-lib.ts");
  let doc: PdfLib.PDFDocument;
  try {
    doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return { items: [], partial: "broken" };
  }
  const out = new Collector();
  const { context } = doc;
  const N = (name: string) => lib.PDFName.of(name);
  const seenActions = new Set<unknown>();

  const text = (obj: PdfLib.PDFObject | undefined): string => {
    if (!obj) return "";
    if (obj instanceof lib.PDFString || obj instanceof lib.PDFHexString) return obj.decodeText();
    if (obj instanceof lib.PDFName) return obj.decodeText();
    if (obj instanceof lib.PDFRawStream) {
      try {
        return decodeUtf8(lib.decodePDFRawStream(obj).decode());
      } catch {
        return "";
      }
    }
    if (obj instanceof lib.PDFDict) return text(obj.lookup(N("UF")) ?? obj.lookup(N("F")));
    return "";
  };
  const dictOf = (obj: PdfLib.PDFObject | undefined) => {
    const value = obj instanceof lib.PDFRef ? context.lookup(obj) : obj;
    return value instanceof lib.PDFDict ? value : undefined;
  };

  const action = (obj: PdfLib.PDFObject | undefined, trigger: Trigger, depth = 0) => {
    const dict = dictOf(obj);
    if (!dict || depth > 20 || seenActions.has(dict)) return;
    seenActions.add(dict);
    const kind = dict.lookup(N("S"));
    const type = kind instanceof lib.PDFName ? kind.decodeText() : "";
    const auto = trigger === "open";
    if (type === "JavaScript") {
      const code = text(dict.lookup(N("JS")));
      const urls = urlsIn(code);
      out.add({ kind: "code", code: "javascript", name: auto ? "open" : "click" });
      for (const url of urls) out.add({ kind: auto ? "connect" : "link", code: auto ? "remote-other" : "hyperlink", url });
    } else if (type === "URI") {
      const url = text(dict.lookup(N("URI")));
      if (url) out.add(auto ? { kind: "connect", code: "open-uri", url } : { kind: "link", code: "hyperlink", url });
    } else if (type === "Launch") {
      const win = dictOf(dict.lookup(N("Win")));
      out.add({ kind: "code", code: "launch", name: text(dict.lookup(N("F"))) || text(win?.lookup(N("F"))) || undefined });
    } else if (type === "SubmitForm") {
      const url = text(dict.lookup(N("F")));
      out.add(auto ? { kind: "connect", code: "remote-data", url } : { kind: "link", code: "submit-form", url: url || undefined });
    } else if (type === "ImportData" || type === "GoToR" || type === "GoToE") {
      const target = text(dict.lookup(N("F")));
      const url = remoteTarget(target);
      if (url) out.add(auto ? { kind: "connect", code: "remote-data", url } : { kind: "link", code: "hyperlink", url });
      else if (type === "GoToE" || target) out.add({ kind: "embedded", code: "embedded-file", name: target || undefined });
    } else if (type === "Rendition" || type === "Movie" || type === "Sound") {
      out.add({ kind: "embedded", code: "embedded-object", name: type });
    }
    const next = dict.lookup(N("Next"));
    if (next instanceof lib.PDFArray) for (let i = 0; i < next.size(); i++) action(next.get(i), trigger, depth + 1);
    else if (next) action(next, trigger, depth + 1);
  };

  const triggers = (aa: PdfLib.PDFObject | undefined, auto: (key: string) => boolean) => {
    const dict = dictOf(aa);
    if (!dict) return;
    for (const [key, value] of dict.entries()) action(value, auto(key.decodeText()) ? "open" : "click");
  };

  // 名稱樹（/Names 或 /Kids），回傳每一對名稱與內容
  const nameTree = (obj: PdfLib.PDFObject | undefined, visit: (name: string, value: PdfLib.PDFObject) => void, depth = 0) => {
    const dict = dictOf(obj);
    if (!dict || depth > 20) return;
    const names = dict.lookup(N("Names"));
    if (names instanceof lib.PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) visit(text(names.lookup(i)), names.get(i + 1));
    const kids = dict.lookup(N("Kids"));
    if (kids instanceof lib.PDFArray) for (let i = 0; i < kids.size(); i++) nameTree(kids.get(i), visit, depth + 1);
  };

  const catalog = doc.catalog;
  const open = catalog.get(N("OpenAction"));
  if (open && !(dictOf(open) === undefined)) action(open, "open");
  triggers(catalog.get(N("AA")), () => true);
  const names = dictOf(catalog.get(N("Names")));
  nameTree(names?.get(N("JavaScript")), (_, value) => action(value, "open"));
  nameTree(names?.get(N("EmbeddedFiles")), (name, value) => out.add({ kind: "embedded", code: "embedded-file", name: text(value) || name }));
  const form = dictOf(catalog.get(N("AcroForm")));
  if (form?.has(N("XFA"))) out.add({ kind: "code", code: "xfa" });

  for (const page of doc.getPages()) {
    triggers(page.node.get(N("AA")), (key) => AUTO_TRIGGERS.has(key));
    const annots = page.node.Annots();
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const annot = dictOf(annots!.get(i));
      if (!annot) continue;
      const subtype = (annot.lookup(N("Subtype")) as PdfLib.PDFName | undefined)?.decodeText?.() ?? "";
      if (subtype === "FileAttachment") out.add({ kind: "embedded", code: "embedded-file", name: text(annot.lookup(N("FS"))) || undefined });
      else if (subtype === "RichMedia" || subtype === "Screen" || subtype === "Movie" || subtype === "Sound" || subtype === "3D")
        out.add({ kind: "embedded", code: "embedded-object", name: subtype });
      action(annot.get(N("A")), "click");
      triggers(annot.get(N("AA")), (key) => AUTO_TRIGGERS.has(key));
    }
  }

  // 沒有從上面的位置引用、但檔案裡還有的 JavaScript，可能由其他動作或表單欄位觸發
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof lib.PDFDict) || seenActions.has(obj)) continue;
    const s = obj.lookup(N("S"));
    if (s instanceof lib.PDFName && s.decodeText() === "JavaScript") action(obj, "click");
  }

  return { items: out.items, partial: doc.isEncrypted ? "encrypted" : undefined };
}

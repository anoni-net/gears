import type * as PdfLib from "pdf-lib";
import { type ReportItem, type RunResult, ToolError } from "../../core/tool.ts";

// 只留下 PDF 裡選中的頁面。pdf-lib 複製頁面時會把頁面引用到的東西一路複製過去，
// 直接複製有兩種方式會把沒選的頁面帶進新檔：
//
// - 連到其他頁的連結、註解的 /P、表單欄位的 /Parent（欄位底下掛著其他頁的元件），
//   都指向另一頁，那一頁的內容會整頁跟著過來
// - 很多產生器讓所有頁面共用一份 Resources，裡面有只在別頁用到的圖片與字型
//
// 所以複製之前先在原檔裡拿掉這些參照，每一頁的 Resources 換成只有這一頁內容用到的，
// 複製之後再從新檔的文件目錄走一遍，確認沒有選中以外的頁面。文件資訊、XMP、書籤、
// 附件、表單設定這類整份文件的資料掛在文件目錄上，新檔不會帶過去。

type Lib = typeof PdfLib;

// 依名稱引用的資源類別。Resources 裡其他的鍵（ProcSet）原樣保留
const NAMED = ["Font", "XObject", "ExtGState", "Pattern", "Shading", "ColorSpace", "Properties"];

// 留下網址連結，其他會跳到別頁、開檔或執行程式的動作一律拿掉
const KEPT_ACTIONS = new Set(["URI"]);

async function load(lib: Lib, bytes: Uint8Array) {
  try {
    const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    // 結構壞掉的檔案 pdf-lib 照樣讀得進來，到讀頁面樹時才出錯
    doc.getPageCount();
    return doc;
  } catch (e) {
    throw new ToolError(e instanceof lib.EncryptedPDFError ? "unsupported" : "broken");
  }
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  const lib = await import("../strip-metadata/pdf-lib.ts");
  return (await load(lib, bytes)).getPageCount();
}

// 內容串流裡出現的名稱（/Im1、/F2）。字串裡的斜線也會被當成名稱，只會多留，不會少留
function namesIn(lib: Lib, stream: PdfLib.PDFObject | undefined, names: Set<string>) {
  if (!(stream instanceof lib.PDFRawStream)) throw new ToolError("broken");
  let text: string;
  try {
    const bytes = lib.decodePDFRawStream(stream).decode();
    text = "";
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  } catch {
    // 解不開的內容判斷不了用到哪些資源，不交出可能帶著其他頁內容的檔案
    throw new ToolError("unsupported");
  }
  for (const m of text.matchAll(/\/([^\s/<>[\]()%{}]+)/g)) {
    names.add(m[1]!.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  }
}

// 這一頁的內容用到的名稱，連同沒有自己 Resources 的表單 XObject（沿用頁面的資源）裡用到的
function usedNames(lib: Lib, doc: PdfLib.PDFDocument, page: PdfLib.PDFPageLeaf, resources: PdfLib.PDFDict): Set<string> {
  const { context } = doc;
  const names = new Set<string>();
  const contents = page.lookup(lib.PDFName.of("Contents"));
  if (contents instanceof lib.PDFArray) {
    for (let i = 0; i < contents.size(); i++) namesIn(lib, contents.lookup(i), names);
  } else if (contents) {
    namesIn(lib, contents, names);
  }
  const xobjects = resources.lookup(lib.PDFName.of("XObject"));
  const seen = new Set<string>();
  let grew = true;
  while (grew && xobjects instanceof lib.PDFDict) {
    grew = false;
    for (const [key, value] of xobjects.entries()) {
      const name = key.decodeText();
      if (!names.has(name) || seen.has(name)) continue;
      seen.add(name);
      const form = context.lookup(value);
      if (!(form instanceof lib.PDFRawStream)) continue;
      if (form.dict.lookup(lib.PDFName.of("Subtype"))?.toString() !== "/Form") continue;
      if (form.dict.has(lib.PDFName.of("Resources"))) continue;
      const before = names.size;
      namesIn(lib, form, names);
      if (names.size > before) grew = true;
    }
  }
  return names;
}

// 一份新的 Resources，每個類別只留用到的名稱
function prunedResources(lib: Lib, doc: PdfLib.PDFDocument, resources: PdfLib.PDFDict, used: Set<string>) {
  const { context } = doc;
  const out = context.obj({});
  for (const [key, value] of resources.entries()) {
    const category = context.lookup(value);
    if (!NAMED.includes(key.decodeText()) || !(category instanceof lib.PDFDict)) {
      out.set(key, value);
      continue;
    }
    const kept = context.obj({});
    for (const [name, entry] of category.entries()) if (used.has(name.decodeText())) kept.set(name, entry);
    if (kept.keys().length) out.set(key, kept);
  }
  return out;
}

// 這些資源用到的字型（連同表單 XObject 自己的 Resources 裡的），用來判斷選中與拿掉的頁面
// 有沒有共用字型。很多產生器整份文件共用一組子集字型，字型裡的字形與字碼對照表（ToUnicode）
// 含有每一頁用到的字，複製頁面時整組帶過去，其他頁用過哪些字（沒有順序與位置）就留在新檔裡
function fontsUsed(lib: Lib, doc: PdfLib.PDFDocument, resources: PdfLib.PDFDict, used: Set<string>, fonts: Set<unknown>, depth = 0) {
  const { context } = doc;
  const fontDict = resources.lookup(lib.PDFName.of("Font"));
  if (fontDict instanceof lib.PDFDict) {
    for (const [name, value] of fontDict.entries()) if (used.has(name.decodeText())) fonts.add(value);
  }
  const xobjects = resources.lookup(lib.PDFName.of("XObject"));
  if (!(xobjects instanceof lib.PDFDict) || depth > 4) return;
  for (const [name, value] of xobjects.entries()) {
    if (!used.has(name.decodeText())) continue;
    const form = context.lookup(value);
    if (!(form instanceof lib.PDFRawStream)) continue;
    const own = form.dict.lookup(lib.PDFName.of("Resources"));
    if (!(own instanceof lib.PDFDict)) continue;
    const names = new Set<string>();
    namesIn(lib, form, names);
    fontsUsed(lib, doc, own, names, fonts, depth + 1);
  }
}

function pageResources(lib: Lib, doc: PdfLib.PDFDocument, page: PdfLib.PDFPageLeaf) {
  const inherited = page.getInheritableAttribute(lib.PDFName.of("Resources"));
  const resources = inherited ? doc.context.lookup(inherited) : undefined;
  return resources instanceof lib.PDFDict ? resources : undefined;
}

// 拿掉註解指向其他頁或其他物件的參照，回傳拿掉了多少個連結、有沒有表單欄位
function cleanAnnots(lib: Lib, doc: PdfLib.PDFDocument, page: PdfLib.PDFPageLeaf) {
  const { context } = doc;
  const annots = page.lookup(lib.PDFName.of("Annots"));
  let links = 0;
  let fields = false;
  if (!(annots instanceof lib.PDFArray)) return { links, fields };
  const kept: PdfLib.PDFObject[] = [];
  for (let i = 0; i < annots.size(); i++) {
    const item = annots.get(i);
    const annot = context.lookup(item);
    if (!(annot instanceof lib.PDFDict)) continue;
    const subtype = annot.lookup(lib.PDFName.of("Subtype"))?.toString();
    for (const key of ["P", "IRT", "Dest", "AA"]) annot.delete(lib.PDFName.of(key));
    if (subtype === "/Widget" && annot.has(lib.PDFName.of("Parent"))) {
      annot.delete(lib.PDFName.of("Parent"));
      fields = true;
    }
    if (subtype === "/Widget" && annot.has(lib.PDFName.of("FT"))) fields = true;
    const action = annot.lookup(lib.PDFName.of("A"));
    if (action instanceof lib.PDFDict && !KEPT_ACTIONS.has(action.lookup(lib.PDFName.of("S"))?.toString().slice(1) ?? "")) {
      annot.delete(lib.PDFName.of("A"));
    } else if (action instanceof lib.PDFDict) {
      // 網址連結的下一個動作（/Next）也可能跳到別頁
      action.delete(lib.PDFName.of("Next"));
    }
    if (subtype === "/Link" && !annot.has(lib.PDFName.of("A"))) {
      links++;
      continue;
    }
    kept.push(item);
  }
  if (kept.length) page.set(lib.PDFName.of("Annots"), context.obj(kept));
  else page.delete(lib.PDFName.of("Annots"));
  return { links, fields };
}

// 從文件目錄走得到的頁面物件
function reachablePages(lib: Lib, doc: PdfLib.PDFDocument): Set<PdfLib.PDFObject> {
  const { context } = doc;
  const seen = new Set<PdfLib.PDFObject>();
  const pages = new Set<PdfLib.PDFObject>();
  const stack: PdfLib.PDFObject[] = [context.trailerInfo.Root!];
  while (stack.length) {
    const obj = stack.pop()!;
    if (seen.has(obj)) continue;
    seen.add(obj);
    if (obj instanceof lib.PDFRef) {
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof lib.PDFDict) {
      if (obj.lookup(lib.PDFName.of("Type"))?.toString() === "/Page") pages.add(obj);
      stack.push(...obj.values());
    } else if (obj instanceof lib.PDFArray) {
      stack.push(...obj.asArray());
    } else if (obj instanceof lib.PDFStream) {
      stack.push(obj.dict);
    }
  }
  return pages;
}

// keep 是從 0 開始的頁碼，依原本的順序輸出
export async function keepPages(bytes: Uint8Array, keep: number[]): Promise<RunResult> {
  const lib = await import("../strip-metadata/pdf-lib.ts");
  const src = await load(lib, bytes);
  const total = src.getPageCount();
  const indices = [...new Set(keep)].sort((a, b) => a - b);
  if (!indices.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= total)) throw new ToolError("unsupported");

  // 拿掉的頁面用到的字型。內容解不開時判斷不了，當成有共用
  const removedFonts = new Set<unknown>();
  let unknownFonts = false;
  for (let index = 0; index < total; index++) {
    if (indices.includes(index)) continue;
    const page = src.getPage(index).node;
    const resources = pageResources(lib, src, page);
    if (!resources) continue;
    try {
      fontsUsed(lib, src, resources, usedNames(lib, src, page, resources), removedFonts);
    } catch {
      unknownFonts = true;
    }
  }

  let links = 0;
  let fields = false;
  const keptFonts = new Set<unknown>();
  for (const index of indices) {
    const page = src.getPage(index).node;
    const resources = pageResources(lib, src, page);
    if (resources) {
      const used = usedNames(lib, src, page, resources);
      fontsUsed(lib, src, resources, used, keptFonts);
      page.set(lib.PDFName.of("Resources"), prunedResources(lib, src, resources, used));
    }
    // 頁面的動作（開啟時執行）與文章串連（/B 指向其他頁的段落）
    page.delete(lib.PDFName.of("AA"));
    page.delete(lib.PDFName.of("B"));
    const cleaned = cleanAnnots(lib, src, page);
    links += cleaned.links;
    fields ||= cleaned.fields;
  }

  const out = await lib.PDFDocument.create({ updateMetadata: false });
  for (const page of await out.copyPages(src, indices)) out.addPage(page);

  // 新檔裡的頁面只能是加進頁面樹的那幾頁
  const added = new Set<PdfLib.PDFObject>(out.getPages().map((p) => p.node));
  for (const page of reachablePages(lib, out)) if (!added.has(page)) throw new ToolError("broken");

  const data = await out.save({ useObjectStreams: false });
  if ((await load(lib, data)).getPageCount() !== indices.length) throw new ToolError("broken");

  const removed: ReportItem[] = [{ code: "pdf-pages-removed", count: total - indices.length }, { code: "pdf-document-level" }];
  if (links) removed.push({ code: "pdf-links", count: links });
  const notes: ReportItem[] = fields ? [{ code: "pdf-fields" }] : [];
  if (keptFonts.size && (unknownFonts || [...keptFonts].some((f) => removedFonts.has(f)))) notes.push({ code: "pdf-shared-fonts" });
  return { data, report: { removed, kept: [{ code: "pdf-pages-kept", count: indices.length }], notes } };
}

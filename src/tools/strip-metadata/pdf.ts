import type * as PdfLib from "pdf-lib";
import { type Finding, type RunResult, ToolError } from "../../core/tool.ts";
import { type Inner, NEUTRAL_AUTHOR, Tally } from "./package.ts";

// PDF。用 pdf-lib 解析整份檔案，處理完整個重新寫出來。pdf-lib 約 500 KB，打開 PDF 時才載入。
//
// 會透露身分的地方：
// - 文件資訊（Info）：作者、標題、建立文件的軟體、轉成 PDF 的軟體、建立與修改時間
// - XMP 描述資料：同樣的資訊再寫一份，常多出編輯紀錄與文件識別碼。文件、頁面、圖片都可能有
// - 文件識別碼（trailer 的 ID）、PieceInfo（Illustrator 等軟體的私有資料）、頁面的修改時間
// - 註解的作者與時間
// - 增量更新：修改 PDF 時常把新內容接在檔尾，舊的版本仍然留在檔案裡。重新寫出時只保留
//   從文件目錄走得到的物件，沒有用到的一律不寫
// - 數位簽章：裡面有簽署人的憑證，修改之後簽章本來就會失效
// - 內嵌的 JPEG 自己的 EXIF
//
// 附加檔案（PDF 裡夾帶的其他檔案）是內容，保留下來，檢查時另外提醒讀者。

type Lib = typeof PdfLib;

// 標記類的註解：/T 是作者。表單欄位的 /T 是欄位名稱，不能動
const MARKUP = new Set([
  "Text",
  "FreeText",
  "Line",
  "Square",
  "Circle",
  "Polygon",
  "PolyLine",
  "Highlight",
  "Underline",
  "Squiggly",
  "StrikeOut",
  "Stamp",
  "Caret",
  "Ink",
  "FileAttachment",
  "Sound",
  "Redact",
]);

const REMOVED_KEYS = ["Metadata", "PieceInfo", "LastModified"];

async function load(lib: Lib, bytes: Uint8Array) {
  try {
    return await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    // 加密的 PDF 內容讀不到，沒辦法確認處理乾淨
    throw new ToolError(e instanceof lib.EncryptedPDFError ? "unsupported" : "broken");
  }
}

// 從文件目錄出發走得到的物件
function reachable(lib: Lib, doc: PdfLib.PDFDocument): Set<PdfLib.PDFRef> {
  const { context } = doc;
  const seen = new Set<PdfLib.PDFRef>();
  const root = context.trailerInfo.Root;
  if (!root) throw new ToolError("broken");
  const stack: PdfLib.PDFObject[] = [root];
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof lib.PDFRef) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      const target = context.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof lib.PDFDict) {
      stack.push(...obj.values());
    } else if (obj instanceof lib.PDFArray) {
      stack.push(...obj.asArray());
    } else if (obj instanceof lib.PDFStream) {
      stack.push(obj.dict);
    }
  }
  return seen;
}

const nameOf = (lib: Lib, dict: PdfLib.PDFDict, key: string) => {
  const value = dict.lookup(lib.PDFName.of(key));
  return value instanceof lib.PDFName ? value.decodeText() : undefined;
};

const textOf = (lib: Lib, dict: PdfLib.PDFDict, key: string) => {
  const value = dict.lookup(lib.PDFName.of(key));
  return value instanceof lib.PDFString || value instanceof lib.PDFHexString ? value.decodeText() : undefined;
};

const isAnnot = (lib: Lib, dict: PdfLib.PDFDict) => nameOf(lib, dict, "Subtype") !== undefined && dict.has(lib.PDFName.of("Rect"));

// 濾鏡只有 DCTDecode 的影像，內容就是一個 JPEG 檔
function isJpeg(lib: Lib, stream: PdfLib.PDFRawStream) {
  if (nameOf(lib, stream.dict, "Subtype") !== "Image") return false;
  const filter = stream.dict.lookup(lib.PDFName.of("Filter"));
  if (filter instanceof lib.PDFName) return filter.decodeText() === "DCTDecode";
  return filter instanceof lib.PDFArray && filter.size() === 1 && filter.lookup(0) instanceof lib.PDFName && filter.lookup(0, lib.PDFName).decodeText() === "DCTDecode";
}

const dictOf = (lib: Lib, obj: PdfLib.PDFObject) =>
  obj instanceof lib.PDFDict ? obj : obj instanceof lib.PDFStream ? obj.dict : undefined;

export async function stripPdf(bytes: Uint8Array, inner: Inner): Promise<RunResult> {
  const lib = await import("./pdf-lib.ts");
  const doc = await load(lib, bytes);
  const { context } = doc;
  const tally = new Tally();

  if (context.trailerInfo.Info) tally.add("doc-properties");
  if (context.trailerInfo.ID) tally.add("doc-ids");
  context.trailerInfo.Info = undefined;
  context.trailerInfo.ID = undefined;

  // 簽章：拿掉欄位的值，簽章的權限設定（/Perms）也一併拿掉
  let signatures = 0;
  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = dictOf(lib, obj);
    const value = dict?.lookup(lib.PDFName.of("V"));
    if (dict && value instanceof lib.PDFDict && nameOf(lib, value, "Type") === "Sig") {
      dict.delete(lib.PDFName.of("V"));
      signatures++;
    }
  }
  if (signatures) {
    doc.catalog.delete(lib.PDFName.of("Perms"));
    tally.add("doc-signature");
  }

  let images = 0;
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    const dict = dictOf(lib, obj);
    if (!dict) continue;
    for (const key of REMOVED_KEYS) {
      if (!dict.has(lib.PDFName.of(key))) continue;
      dict.delete(lib.PDFName.of(key));
      tally.add(key === "Metadata" ? "xmp" : "doc-ids");
    }
    if (isAnnot(lib, dict)) {
      if (MARKUP.has(nameOf(lib, dict, "Subtype")!) && dict.has(lib.PDFName.of("T"))) {
        dict.set(lib.PDFName.of("T"), lib.PDFHexString.fromText(NEUTRAL_AUTHOR));
        tally.add("doc-authors");
      }
      for (const key of ["M", "CreationDate"]) {
        if (!dict.has(lib.PDFName.of(key))) continue;
        dict.delete(lib.PDFName.of(key));
        tally.add("doc-authors");
      }
    }
    if (nameOf(lib, dict, "Type") === "EmbeddedFile") {
      const params = dict.lookup(lib.PDFName.of("Params"));
      if (params instanceof lib.PDFDict) {
        params.delete(lib.PDFName.of("CreationDate"));
        params.delete(lib.PDFName.of("ModDate"));
      }
    }
    if (obj instanceof lib.PDFRawStream && isJpeg(lib, obj)) {
      const result = await inner.strip(obj.contents);
      if (result?.report.removed.length) {
        context.assign(ref, lib.PDFRawStream.of(obj.dict, result.data));
        images++;
      }
    }
  }
  if (images) tally.add("doc-images");

  // 最後才清：前面拿掉的 XMP、簽章與文件資訊也會變成沒有用到的物件。
  // 其他沒有用到的多半是修改之前的舊版本
  const keep = reachable(lib, doc);
  let unused = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (keep.has(ref)) continue;
    context.delete(ref);
    unused++;
  }
  if (unused) tally.add("doc-unused");

  // 不用物件串流：舊的閱讀器也能開，讀者用文字編輯器也看得到裡面剩下什麼
  const data = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  // 重新載入一次，讀不回來的結果不交出去
  await load(lib, data);
  return { data, report: { removed: tally.items(), kept: [{ code: "doc-content" }] } };
}

// PDF 的時間寫成 D:20240131093000+08'00'
function pdfDate(text: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(text);
  if (!m) return text;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export async function inspectPdf(bytes: Uint8Array, inner: Inner): Promise<Finding[]> {
  const lib = await import("./pdf-lib.ts");
  const doc = await load(lib, bytes);
  const { context } = doc;
  const findings: Finding[] = [];
  const names = new Set<string>();
  const attachments: string[] = [];
  let comments = 0;

  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof lib.PDFDict) {
    const author = textOf(lib, info, "Author");
    if (author) names.add(author);
    for (const key of ["Creator", "Producer"]) {
      const value = textOf(lib, info, key);
      if (value) findings.push({ code: "software", value: value.slice(0, 80) });
    }
    for (const key of ["CreationDate", "ModDate"]) {
      const value = textOf(lib, info, key);
      if (value) findings.push({ code: "datetime", value: pdfDate(value) });
    }
    for (const key of ["Title", "Subject", "Keywords"]) {
      const value = textOf(lib, info, key);
      if (value) findings.push({ code: "text", value: value.slice(0, 80) });
    }
  }
  if (context.trailerInfo.ID) findings.push({ code: "other" });

  for (const [, obj] of context.enumerateIndirectObjects()) {
    const dict = dictOf(lib, obj);
    if (!dict) continue;
    if (dict.has(lib.PDFName.of("Metadata"))) findings.push({ code: "xmp" });
    if (dict.has(lib.PDFName.of("PieceInfo"))) findings.push({ code: "other" });
    if (isAnnot(lib, dict) && MARKUP.has(nameOf(lib, dict, "Subtype")!)) {
      comments++;
      const author = textOf(lib, dict, "T");
      if (author) names.add(author);
    }
    if (nameOf(lib, dict, "Type") === "Sig") {
      findings.push({ code: "signature", value: textOf(lib, dict, "Name") });
    }
    if (nameOf(lib, dict, "Type") === "Filespec" && dict.has(lib.PDFName.of("EF"))) {
      attachments.push(textOf(lib, dict, "UF") ?? textOf(lib, dict, "F") ?? "");
    }
    if (obj instanceof lib.PDFRawStream && isJpeg(lib, obj)) findings.push(...((await inner.inspect(obj.contents)) ?? []));
  }

  names.delete(NEUTRAL_AUTHOR);
  if (names.size) findings.unshift({ code: "owner", value: [...names].slice(0, 5).join("、") });
  if (comments) findings.push({ code: "doc-comments" });
  if (attachments.length) findings.push({ code: "attachments", value: attachments.filter(Boolean).slice(0, 5).join("、") || undefined });
  return findings;
}

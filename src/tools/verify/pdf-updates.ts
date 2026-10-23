import type * as PdfLib from "pdf-lib";

// 簽完之後的增量更新是不是只加入驗證用的資料（anoni-net/gears#128）。PAdES 長期驗證在簽章之後
// 用增量更新加上 /DSS（驗證用的憑證、OCSP 回應與撤銷清單）與文件時間戳記，簽章不會涵蓋到。
// 把簽章涵蓋的那個版本跟最後的版本逐一比對物件，改動的物件都屬於下列幾種才算：
//
// - /DSS 底下的物件：新加的，或在兩個版本都掛在 /DSS 底下（/DSS 與 /VRI 本身會更新）
// - 文件時間戳記的簽章、它的簽章欄位、欄位的外觀，都要是新加的物件
// - 文件目錄只改了 /DSS、/Extensions、/Version、/Metadata、/AcroForm
// - /AcroForm 的 /Fields 與頁面的 /Annots 只多了上面那些簽章欄位
// - XMP 與文件資訊（Info）：寫入的工具常順便更新修改時間與軟體名稱，不算內容，另外標出來
//
// 既有的物件只有掛在舊版的 /DSS 底下才能改，否則把頁面的內容掛到 /DSS 底下再改掉，就會被當成驗證資料

type Lib = typeof PdfLib;

export interface LaterUpdates {
  validationOnly: boolean; // 簽完之後只加入驗證用的資料
  metadata: boolean; // 同時更新了 XMP 或文件資訊
}

const key = (ref: PdfLib.PDFRef) => ref.toString();

function name(lib: Lib, dict: PdfLib.PDFDict, k: string): string | undefined {
  const v = dict.get(lib.PDFName.of(k));
  return v instanceof lib.PDFName ? v.decodeText() : undefined;
}

// 從 start 走得到的所有間接物件，skip 列出不往下走的鍵（/P、/Parent 會走回頁面）
function reachable(lib: Lib, ctx: PdfLib.PDFContext, start: PdfLib.PDFObject | undefined, skip: string[] = []): Set<string> {
  const seen = new Set<string>();
  const walk = (o: PdfLib.PDFObject | undefined, depth: number) => {
    if (!o || depth > 32) return;
    if (o instanceof lib.PDFRef) {
      if (seen.has(key(o))) return;
      seen.add(key(o));
      walk(ctx.lookup(o), depth + 1);
    } else if (o instanceof lib.PDFDict) {
      for (const [k, v] of o.entries()) if (!skip.includes(k.decodeText())) walk(v, depth + 1);
    } else if (o instanceof lib.PDFArray) {
      for (const v of o.asArray()) walk(v, depth + 1);
    } else if (o instanceof lib.PDFStream) {
      walk(o.dict, depth + 1);
    }
  };
  walk(start, 0);
  return seen;
}

const text = (o: PdfLib.PDFObject | undefined) => (o === undefined ? "" : o.toString());

// 陣列只多了 extra 裡的參照，原本的項目都還在
function grew(lib: Lib, before: PdfLib.PDFObject | undefined, after: PdfLib.PDFObject | undefined, extra: Set<string>): boolean {
  const a = before instanceof lib.PDFArray ? before.asArray().map(text) : [];
  if (!(after instanceof lib.PDFArray)) return a.length === 0;
  const b = after.asArray();
  const left = [...a];
  for (const item of b) {
    const i = left.indexOf(text(item));
    if (i >= 0) left.splice(i, 1);
    else if (!(item instanceof lib.PDFRef && extra.has(key(item)))) return false;
  }
  return left.length === 0;
}

// 兩個字典只有 allow 裡的鍵不一樣，allow 的值是檢查那個鍵的函式
function sameExcept(before: PdfLib.PDFDict, after: PdfLib.PDFDict, allow: Record<string, (a?: PdfLib.PDFObject, b?: PdfLib.PDFObject) => boolean>): boolean {
  const keys = new Set([...before.keys(), ...after.keys()].map((k) => k.decodeText()));
  for (const k of keys) {
    const a = before.entries().find(([n]) => n.decodeText() === k)?.[1];
    const b = after.entries().find(([n]) => n.decodeText() === k)?.[1];
    if (text(a) === text(b)) continue;
    const check = allow[k];
    if (!check || !check(a, b)) return false;
  }
  return true;
}

export async function laterUpdates(lib: Lib, bytes: Uint8Array, end: number, doc: PdfLib.PDFDocument): Promise<LaterUpdates | undefined> {
  let old: PdfLib.PDFDocument;
  try {
    old = await lib.PDFDocument.load(bytes.subarray(0, end), { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return undefined;
  }
  const ctx = doc.context;
  const oldCtx = old.context;
  const resolve = (c: PdfLib.PDFContext, o?: PdfLib.PDFObject) => (o instanceof lib.PDFRef ? c.lookup(o) : o);

  const changed: [PdfLib.PDFRef, PdfLib.PDFObject][] = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof lib.PDFRawStream && ["XRef", "ObjStm"].includes(name(lib, obj.dict, "Type") ?? "")) continue;
    if (text(oldCtx.lookup(ref)) !== text(obj)) changed.push([ref, obj]);
  }
  const result: LaterUpdates = { validationOnly: true, metadata: false };
  if (!changed.length) return result;
  const isNew = (ref: PdfLib.PDFRef) => oldCtx.lookup(ref) === undefined;

  const dssKey = lib.PDFName.of("DSS");
  const newDss = reachable(lib, ctx, doc.catalog.get(dssKey));
  const oldDss = reachable(lib, oldCtx, old.catalog.get(dssKey));

  // 文件時間戳記：簽章字典、指到它的簽章欄位，以及欄位與外觀用到的新物件
  const stamps = new Set<string>();
  for (const [ref, obj] of changed) {
    if (isNew(ref) && obj instanceof lib.PDFDict && (name(lib, obj, "Type") === "DocTimeStamp" || name(lib, obj, "SubFilter") === "ETSI.RFC3161")) stamps.add(key(ref));
  }
  const fields = new Set<string>();
  for (const [ref, obj] of changed) {
    if (!isNew(ref) || !(obj instanceof lib.PDFDict) || name(lib, obj, "FT") !== "Sig") continue;
    const v = obj.get(lib.PDFName.of("V"));
    if (v instanceof lib.PDFRef && stamps.has(key(v))) fields.add(key(ref));
  }
  for (const [ref, obj] of changed) {
    const parent = obj instanceof lib.PDFDict ? obj.get(lib.PDFName.of("Parent")) : undefined;
    if (isNew(ref) && parent instanceof lib.PDFRef && fields.has(key(parent)) && name(lib, obj as PdfLib.PDFDict, "Subtype") === "Widget") fields.add(key(ref));
  }
  const stampObjects = new Set<string>();
  for (const f of fields) {
    const ref = changed.find(([r]) => key(r) === f)![0];
    for (const k of reachable(lib, ctx, ref, ["P", "Parent"])) stampObjects.add(k);
  }

  const rootRef = ctx.trailerInfo.Root;
  const infoRef = ctx.trailerInfo.Info;
  const metadataRef = doc.catalog.get(lib.PDFName.of("Metadata"));
  const acroKey = lib.PDFName.of("AcroForm");
  const newAcro = resolve(ctx, doc.catalog.get(acroKey));
  const oldAcro = resolve(oldCtx, old.catalog.get(acroKey));
  const acroRef = doc.catalog.get(acroKey);

  const acroOk = () => {
    if (!(newAcro instanceof lib.PDFDict)) return oldAcro === undefined;
    const before = oldAcro instanceof lib.PDFDict ? oldAcro : lib.PDFDict.withContext(oldCtx);
    return sameExcept(before, newAcro, {
      Fields: (a, b) => grew(lib, resolve(oldCtx, a), resolve(ctx, b), fields),
      SigFlags: () => true,
    });
  };

  for (const [ref, obj] of changed) {
    const k = key(ref);
    if (isNew(ref) ? newDss.has(k) || stamps.has(k) || stampObjects.has(k) : newDss.has(k) && oldDss.has(k)) continue;
    if (rootRef instanceof lib.PDFRef && k === key(rootRef) && obj instanceof lib.PDFDict) {
      const ok = sameExcept(old.catalog, obj, { DSS: () => true, Extensions: () => true, Version: () => true, Metadata: () => true, AcroForm: () => acroOk() });
      if (ok) continue;
    } else if (acroRef instanceof lib.PDFRef && k === key(acroRef)) {
      if (acroOk()) continue;
    } else if ((metadataRef instanceof lib.PDFRef && k === key(metadataRef)) || (infoRef instanceof lib.PDFRef && k === key(infoRef))) {
      result.metadata = true;
      continue;
    } else if (obj instanceof lib.PDFDict && name(lib, obj, "Type") === "Page") {
      const before = oldCtx.lookup(ref);
      if (before instanceof lib.PDFDict && sameExcept(before, obj, { Annots: (a, b) => grew(lib, resolve(oldCtx, a), resolve(ctx, b), fields) })) continue;
    } else if (obj instanceof lib.PDFArray && !isNew(ref)) {
      // 獨立成一個物件的 /Annots 或 /Fields
      if (grew(lib, oldCtx.lookup(ref), obj, fields)) continue;
    }
    result.validationOnly = false;
    return result;
  }
  return result;
}

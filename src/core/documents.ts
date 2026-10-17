import { readZip, storedData } from "./zip.ts";

// Office（OOXML）與 ODF 文件都是 zip，從裡面的檔案判斷是哪一種。

export type OoxmlKind = "docx" | "xlsx" | "pptx" | "docm" | "xlsm" | "pptm";

// 用 zip 裡的檔名判斷是哪一種。有巨集的版本帶著 vbaProject.bin，另外算成 docm、xlsm、pptm：
// 清除中繼資料不處理（只清外殼、巨集原樣留著不妥），文件開啟前檢查要讀得到
export function ooxmlKind(names: string[]): OoxmlKind | null {
  if (!names.includes("[Content_Types].xml")) return null;
  const macro = names.some((n) => /vbaProject\.bin$/i.test(n));
  if (names.includes("word/document.xml")) return macro ? "docm" : "docx";
  if (names.includes("xl/workbook.xml")) return macro ? "xlsm" : "xlsx";
  if (names.includes("ppt/presentation.xml")) return macro ? "pptm" : "pptx";
  return null;
}

export type OdfKind = "odt" | "ods" | "odp" | "odg";

// ODF 與 EPUB 的第一個檔案是不壓縮的 mimetype
const MIMETYPES: Record<string, OdfKind | "epub"> = {
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.graphics": "odg",
  "application/epub+zip": "epub",
};

export function mimetypeKind(bytes: Uint8Array): OdfKind | "epub" | null {
  try {
    const first = readZip(bytes).entries[0];
    if (first?.name !== "mimetype") return null;
    const data = storedData(bytes, first);
    return data ? (MIMETYPES[new TextDecoder().decode(data).trim()] ?? null) : null;
  } catch {
    return null;
  }
}

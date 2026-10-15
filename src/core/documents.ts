import { readZip, storedData } from "./zip.ts";

// Office（OOXML）與 ODF 文件都是 zip，從裡面的檔案判斷是哪一種。

export type OoxmlKind = "docx" | "xlsx" | "pptx";

// 用 zip 裡的檔名判斷是哪一種。有巨集的版本（docm 等）帶著 vbaProject.bin，先不處理
export function ooxmlKind(names: string[]): OoxmlKind | null {
  if (!names.includes("[Content_Types].xml") || names.some((n) => /vbaProject\.bin$/i.test(n))) return null;
  if (names.includes("word/document.xml")) return "docx";
  if (names.includes("xl/workbook.xml")) return "xlsx";
  if (names.includes("ppt/presentation.xml")) return "pptx";
  return null;
}

export type OdfKind = "odt" | "ods" | "odp" | "odg";

const MIMETYPES: Record<string, OdfKind> = {
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.graphics": "odg",
};

export function odfKind(bytes: Uint8Array): OdfKind | null {
  try {
    const first = readZip(bytes).entries[0];
    if (first?.name !== "mimetype") return null;
    const data = storedData(bytes, first);
    return data ? (MIMETYPES[new TextDecoder().decode(data).trim()] ?? null) : null;
  } catch {
    return null;
  }
}

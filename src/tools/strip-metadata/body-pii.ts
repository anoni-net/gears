import type { Finding } from "../../core/tool.ts";
import { walkXml } from "../../core/xml.ts";
import { findPiiInText } from "../redact/pii.ts";

// 文件內文裡的個資（#143）：清除中繼資料只清掉作者、公司、印表機與路徑，內文裡順手寫下的電話、
// Email 都還在。讀出 Office 與 ODF 文件的文字，用遮蔽與寫作習慣檢查同一套規則（redact/pii.ts）
// 找個資，列在「文件內容裡要留意的」，提醒讀者回到原本的軟體修改。工作台不改寫內文。
// 人名、地址、機構要等個資辨識模型（#139），這裡只找有固定格式的。

// OOXML 的文字都在 t（w:t、a:t、試算表的 t）裡，刪除的追蹤修訂在 w:delText，仍然留在檔案裡
const OOXML_TEXT = new Set(["t", "delText"]);
// 換段的元素：Word 與 PowerPoint 的段落、試算表的字串與儲存格、表格的格子。段落之間斷開，
// 前一段結尾的數字才不會跟下一段開頭的數字接成一串電話
const OOXML_BREAK = new Set(["p", "si", "c", "tc", "br", "cr"]);

const isOoxml = (ns: string | null) => !!ns && (ns.includes("openxmlformats.org") || ns.includes("purl.oclc.org/ooxml"));

// 一個 OOXML 部件（word/document.xml、ppt/slides/slide1.xml、xl/sharedStrings.xml……）的文字。
// 同一段被拆成好幾個 run 時直接接起來（「0912-」、「345-678」）
export function ooxmlText(source: string): string {
  const out: string[] = [];
  walkXml(source, (el, text) => {
    if (!isOoxml(el.ns)) return;
    if (text === null) {
      if (OOXML_BREAK.has(el.local)) out.push("\n");
      else if (el.local === "tab") out.push(" ");
    } else if (OOXML_TEXT.has(el.local)) out.push(text);
  });
  return out.join("");
}

// 內文所在的部件：Word、PowerPoint、Excel 底下的 XML，含頁首頁尾、註腳、註解、備忘稿。
// 關聯檔、文件摘要與 customXml 不算，那些是中繼資料，另外列
export const isOoxmlBody = (name: string) => /^(word|ppt|xl)\/(?!.*_rels\/).+\.xml$/i.test(name);

const ODF_TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";

// ODF 的文字在 text:p、text:h 與裡面的 text:span、text:a 這類元素裡
export function odfText(source: string): string {
  const out: string[] = [];
  walkXml(source, (el, text) => {
    if (text === null) {
      if (el.ns === ODF_TEXT_NS && (el.local === "p" || el.local === "h" || el.local === "line-break")) out.push("\n");
      else if (el.ns === ODF_TEXT_NS && (el.local === "s" || el.local === "tab")) out.push(" ");
      return;
    }
    if (el.ns === ODF_TEXT_NS || el.parents.some((p) => p.ns === ODF_TEXT_NS && (p.local === "p" || p.local === "h"))) out.push(text);
  });
  return out.join("");
}

// 內容檔與樣式檔（頁首頁尾在 styles.xml）
export const isOdfBody = (name: string) => /(^|\/)(content|styles)\.xml$/.test(name) && !name.startsWith("META-INF/");

// 找到的每一處個資一筆，畫面上由 mergeFindings 合併、去掉重複的
export function bodyPiiFindings(text: string): Finding[] {
  return findPiiInText(text).map((m) => ({ code: "body-pii", value: m.text }));
}

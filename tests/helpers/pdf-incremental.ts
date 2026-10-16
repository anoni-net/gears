import { PDFDocument, PDFName, type PDFRef } from "pdf-lib";

// 有兩個版本的 PDF，用真正的增量更新做出來：第二版只在檔尾接上改過的物件、新的交互參照表
// 與指向前一份的 /Prev，前面的位元組一個都不動，跟編輯軟體「儲存」時的做法相同。
//
// 第一頁寫著 Amount 100、左下角一塊藍色方塊；第二版改成 Amount 900，方塊移到右邊，
// 文件資訊加上修改時間。第二頁兩個版本相同。

const enc = new TextEncoder();
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

export const PAGE_ONE_BEFORE = "BT /F1 18 Tf 40 120 Td (Amount 100) Tj ET 0 0 1 rg 40 40 60 30 re f";
export const PAGE_ONE_AFTER = "BT /F1 18 Tf 40 120 Td (Amount 900) Tj ET 0 0 1 rg 180 40 60 30 re f";

export async function incrementalPdf(): Promise<{ bytes: Uint8Array; firstEnd: number }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }));
  const content: PDFRef[] = [];
  for (const text of [PAGE_ONE_BEFORE, "BT /F1 18 Tf 40 120 Td (Unchanged page) Tj ET"]) {
    const page = doc.addPage([300, 200]);
    page.node.set(PDFName.of("Resources"), ctx.obj({ Font: { F1: font } }));
    const ref = ctx.register(ctx.stream(text));
    page.node.set(PDFName.of("Contents"), ref);
    content.push(ref);
  }
  doc.setAuthor("Reporter A");
  doc.setCreationDate(new Date("2024-06-01T02:00:00Z"));
  const base = await doc.save({ useObjectStreams: false });

  const prev = [...latin1(base).matchAll(/startxref\s+(\d+)/g)].at(-1)![1]!;
  const root = ctx.trailerInfo.Root!.toString();
  const info = ctx.trailerInfo.Info as PDFRef;
  const objects: [number, string][] = [
    [content[0]!.objectNumber, `<< /Length ${PAGE_ONE_AFTER.length} >>\nstream\n${PAGE_ONE_AFTER}\nendstream`],
    [info.objectNumber, "<< /Author (Reporter A) /CreationDate (D:20240601020000Z) /ModDate (D:20240602020000Z) >>"],
  ];
  let body = "\n";
  const offsets: [number, number][] = [];
  for (const [num, value] of objects) {
    offsets.push([num, base.length + enc.encode(body).length]);
    body += `${num} 0 obj\n${value}\nendobj\n`;
  }
  const xrefAt = base.length + enc.encode(body).length;
  let xref = "xref\n0 1\n0000000000 65535 f \n";
  for (const [num, at] of offsets.sort((a, b) => a[0] - b[0])) xref += `${num} 1\n${String(at).padStart(10, "0")} 00000 n \n`;
  const size = ctx.largestObjectNumber + 1;
  const tail = `${xref}trailer\n<< /Size ${size} /Root ${root} /Info ${info.toString()} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const update = enc.encode(body + tail);
  const bytes = new Uint8Array(base.length + update.length);
  bytes.set(base);
  bytes.set(update, base.length);
  // 第一版的結尾算到 %%EOF 後面的換行
  return { bytes, firstEnd: base.length + 1 };
}

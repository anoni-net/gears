import { PDFDocument, StandardFonts } from "pdf-lib";

// 有文字層的 PDF（400×200 點）：一行電話、一行 Email、一行一般的文字，遮蔽的自動尋找讀文字層用。
// image 有內容時另外在右下角 (200,10) 起 180×72 點貼一張圖
export async function textPdf(image?: Uint8Array): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  page.drawText("Call 0912-345-678", { x: 50, y: 160, size: 12, font });
  page.drawText("jane.doe@example.org", { x: 50, y: 140, size: 12, font });
  page.drawText("See you tomorrow", { x: 50, y: 120, size: 12, font });
  if (image) page.drawImage(await doc.embedPng(image), { x: 200, y: 10, width: 180, height: 72 });
  return Buffer.from(await doc.save());
}

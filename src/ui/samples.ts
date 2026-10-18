// 範例頁的檔案（src/ui/SamplesPage.tsx）。按下按鈕時才產生，產生的程式與 pdf-lib 用到時才載入。
// 照片用 canvas 畫一張圖再插進 EXIF，其他由 src/tools/samples/files.ts 直接寫出位元組。

export const FILE_SAMPLES = [
  { id: "photo", tool: "strip-metadata", name: "IMG_2048.JPG", type: "image/jpeg" },
  { id: "docx", tool: "doc-check", name: "讀書會通知.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { id: "eml", tool: "email-check", name: "帳戶異常通知.eml", type: "message/rfc822" },
  { id: "pdf", tool: "verify", name: "報價單-2026-118.pdf", type: "application/pdf" },
] as const;

export type FileSample = (typeof FILE_SAMPLES)[number];

// 一張看得出是範例的風景：天空、山、一棟高樓與文字。Tor Browser 沒有允許讀取 canvas 時
// toBlob 給的是雜訊，照樣是一張帶 EXIF 的 JPEG，清除中繼資料一樣能示範
async function photoJpeg(): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, "#7cc4e8");
  sky.addColorStop(1, "#e4f3fa");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#5d8a6a";
  ctx.beginPath();
  ctx.moveTo(0, 700);
  ctx.quadraticCurveTo(300, 520, 620, 680);
  ctx.quadraticCurveTo(900, 560, 1200, 660);
  ctx.lineTo(1200, 900);
  ctx.lineTo(0, 900);
  ctx.fill();
  ctx.fillStyle = "#35505e";
  for (let i = 0; i < 8; i++) ctx.fillRect(560 + i * 4, 180 + i * 60, 80 - i * 8, 62);
  ctx.fillRect(596, 120, 8, 60);
  ctx.fillStyle = "#00202d";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText("anoni.net Gears", 60, 110);
  ctx.font = "32px sans-serif";
  ctx.fillText("SAMPLE PHOTO", 60, 160);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function makeSampleFile(sample: FileSample): Promise<File> {
  const files = await import("../tools/samples/files.ts");
  const data =
    sample.id === "photo"
      ? files.withPhoneExif(await photoJpeg())
      : sample.id === "docx"
        ? await files.trackedDocx()
        : sample.id === "eml"
          ? files.phishingEmail()
          : await files.revisedPdf();
  return new File([data as Uint8Array<ArrayBuffer>], sample.name, { type: sample.type });
}

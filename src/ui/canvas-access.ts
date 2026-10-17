// 讀取 canvas 的像素之前先確認讀得到真的內容。
//
// Tor Browser（以及開了 resistFingerprinting 的 Firefox）防止網站用 canvas 辨識裝置，讀者允許之前，
// getImageData、toBlob 一律得到亂數，不會報錯。不檢查的話，HEIC 轉成的 JPEG、遮蔽與轉成圖片的 PDF
// 會是一張雜訊圖，QR code 與人臉也找不到。讀者點了按鈕之後的第一次讀取會讓 Tor Browser 在網址列
// 跳出詢問，允許之後同一個分頁就讀得到了。
//
// Brave 也會擾動讀出來的像素，只差一兩個色階，門檻要容得下。

export class CanvasBlockedError extends Error {
  constructor() {
    super("canvas-blocked");
  }
}

let readable = false;

// 畫兩黑兩白四個點再讀回來。允許過之後就不再檢查，沒允許的每次都重新檢查，讀者可能剛按了允許
export function canvasReadable(): boolean {
  if (readable) return true;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 4, 1);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 2, 1);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, 4, 1).data;
  } catch {
    return false;
  }
  readable = [0, 0, 255, 255].every((v, px) =>
    [0, 1, 2].every((c) => Math.abs(data[px * 4 + c]! - v) <= 24) && data[px * 4 + 3] === 255,
  );
  return readable;
}

export function assertCanvasReadable(): void {
  if (!canvasReadable()) throw new CanvasBlockedError();
}

export const isCanvasBlocked = (error: unknown) => error instanceof CanvasBlockedError;

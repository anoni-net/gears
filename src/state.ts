import type { Format } from "./core/bytes.ts";
import { createTray } from "./core/tray.ts";
import { fileTools } from "./tools/index.ts";

// 處理完的影像實際解碼一次，解不開就放棄這次的結果。加密檔由加密工具自己驗證
// （用同一組密語解密一次），其他格式瀏覽器沒有辦法開啟，不在這裡檢查。HEIC 只有
// Safari 能解碼，清除時只在原地改寫中繼資料、長度與結構都不變，由單元測試保證。
async function verifyImage(blob: Blob, format: Format) {
  if (format !== "jpeg" && format !== "png") return;
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

export const tray = createTray(fileTools, verifyImage);

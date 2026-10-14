import type { Format } from "./core/bytes.ts";
import { createTray } from "./core/tray.ts";
import { fileTools } from "./tools/index.ts";

// 處理完的影像實際解碼一次，解不開就放棄這次的結果。加密檔由加密工具自己驗證
// （用同一組密語解密一次），其他格式瀏覽器沒有辦法開啟，不在這裡檢查。
async function verifyImage(blob: Blob, format: Format) {
  if (format !== "jpeg" && format !== "png") return;
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

export const tray = createTray(fileTools, verifyImage);

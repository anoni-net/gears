import type { Format } from "./core/bytes.ts";
import { createTray } from "./core/tray.ts";
import { fileTools } from "./tools/index.ts";

// 處理完的影像實際解碼一次，解不開就放棄這次的結果。
async function verifyImage(blob: Blob, format: Format) {
  if (format === "unknown") throw new Error("verify");
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

export const tray = createTray(fileTools, verifyImage);

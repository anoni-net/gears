import type { Format } from "./core/bytes.ts";
import { ToolError } from "./core/tool.ts";
import { createTray } from "./core/tray.ts";
import { fileTools } from "./tools/index.ts";
import { type FailReason, fileKind, track, trackFail } from "./ui/analytics.ts";

// 處理完的影像實際解碼一次，解不開就放棄這次的結果。加密檔由加密工具自己驗證
// （用同一組密語解密一次），其他格式瀏覽器沒有辦法開啟，不在這裡檢查。HEIC 只有
// Safari 能解碼，清除時只在原地改寫中繼資料、長度與結構都不變，由單元測試保證。
async function verifyImage(blob: Blob, format: Format) {
  if (format !== "jpeg" && format !== "png") return;
  const bitmap = await createImageBitmap(blob);
  bitmap.close();
}

function reason(error: unknown, large: boolean): FailReason {
  if (!(error instanceof ToolError)) return "other";
  return error.reason === "unsupported" && large ? "too-large" : error.reason;
}

// 使用統計（src/ui/analytics.ts）：讀者加入的檔案只記大類，處理完成與失敗記工具 id 與原因
export const tray = createTray(fileTools, verifyImage, {
  added(formats, origin) {
    // 工具產生的檔案（逐字稿、查證紀錄）由那個工具自己記錄完成
    if (origin) return;
    for (const kind of new Set(formats.map(fileKind))) track("file-add", { kind });
  },
  unreadable: () => trackFail("tray", "too-large"),
  versioned: (tool) => track("tool-done", { tool }),
  failed: (tool, error, large) => trackFail(tool, reason(error, large)),
});

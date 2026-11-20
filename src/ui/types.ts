import type { Format } from "../core/bytes.ts";
import type { Report } from "../core/tool.ts";
import type { Box } from "../tools/redact/index.ts";

// 從空白開始的工具的元件介面。產出檔案的工具呼叫 onCreate，檔案放進暫存區。
export interface CreateToolProps {
  preset?: string;
  onCreate(file: File): void;
  // 打開另一個工具，例如把讀到的網址交給網址檢查
  onOpenTool(id: string, preset?: string): void;
}

// 需要編輯畫面的檔案工具。完成時把結果交給 onDone，由暫存區解碼檢查後加成新版本。
export interface FileEditorProps {
  blob: Blob;
  format: Format;
  onDone(blob: Blob, report: Report): void;
  onCancel(): void;
  // 只有遮蔽用：檔案畫面的「檢查畫面內容」已經找到的框（src/ui/ScreenCheck.tsx），打開時直接放好。
  // 座標是 blob 這個版本的原圖像素，maybe 是可能是臉、畫成虛線的範圍
  found?: { boxes: Box[]; maybe: Box[] };
}

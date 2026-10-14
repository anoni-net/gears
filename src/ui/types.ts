// 從空白開始的工具的元件介面。產出檔案的工具呼叫 onCreate，檔案放進暫存區。
export interface CreateToolProps {
  preset?: string;
  onCreate(file: File): void;
  // 打開另一個工具，例如把讀到的網址交給網址檢查
  onOpenTool(id: string, preset?: string): void;
}

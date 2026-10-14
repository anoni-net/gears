// 從空白開始的工具的元件介面。產出檔案的工具呼叫 onCreate，檔案放進暫存區。
export interface CreateToolProps {
  preset?: string;
  onCreate(file: File): void;
}

import type { TrayFile } from "../core/tray.ts";
import { tray } from "../state.ts";

// 從檔案畫面的工具列表打開從空白開始的工具時，網址不帶檔案，用預設值「tray:<檔案 id>」
// 告訴工具要讀暫存區裡的哪一個檔案（src/ui/FileView.tsx 的 openCreate）

export function trayFileFromPreset(preset?: string): TrayFile | undefined {
  const id = preset?.startsWith("tray:") ? Number(preset.slice(5)) : NaN;
  return tray.get().files.find((f) => f.id === id);
}

// 暫存區檔案的最新版本，當成讀者選的檔案
export const latestAsFile = (f: TrayFile) => new File([f.versions.at(-1)!.blob], f.name);

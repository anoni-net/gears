import { type Format, sniff } from "../core/bytes.ts";
import { navigate } from "../router.ts";
import { tray } from "../state.ts";
import { CHECK_FORMATS } from "../tools/doc-check/index.ts";

// 從信件的附件或查證的檔案卡片，打開文件開啟前檢查（src/ui/DocCheckEditor.tsx）。
// 選好的檔案在暫存區裡，網址換成 /gears/doc-check/，檔案畫面就直接打開那個工具

export const checkableFormat = (format: Format) => CHECK_FORMATS.includes(format);
export const checkableData = (data: Uint8Array) => checkableFormat(sniff(data));

// 還不在暫存區的附件：先加進去（當成讀者自己加入的原檔）
export async function checkAttachment(file: File) {
  await tray.add([file]);
  navigate("doc-check");
}

// 已經在暫存區的檔案
export function checkTrayFile(id: number) {
  tray.select(id);
  navigate("doc-check");
}

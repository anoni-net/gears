import { EXTENSION, type Format } from "../core/bytes.ts";
import type { TrayFile } from "../core/tray.ts";

// 下載的檔名不沿用原檔名（常帶有拍攝日期），只決定副檔名。不能預覽的檔案沒有
// 可靠的格式判斷，沿用原檔名的副檔名，解密時先拿掉 .age
function extension(name: string, format: Format): string {
  // PNM 有 pbm、pgm、ppm、pam 幾種副檔名，沿用原本的
  if (format === "pnm") return /\.(pbm|pgm|ppm|pnm|pam)$/i.exec(name)?.[1]?.toLowerCase() ?? EXTENSION.pnm;
  // 壓縮檔沿用原本的副檔名：jar、cbz 這類也是 ZIP，.tar.gz 是兩層
  if (format === "gz") return /\.(tar\.gz|tgz|svgz|gz)$/i.exec(name)?.[1]?.toLowerCase() ?? EXTENSION.gz;
  if (format === "zip") return /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase() ?? EXTENSION.zip;
  if (format !== "unknown") return EXTENSION[format];
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name.replace(/\.age$/i, ""))?.[1];
  return ext ? ext.toLowerCase() : EXTENSION.unknown;
}

// 暫存區裡第幾個檔案就叫 gears-第幾個，單檔下載與一次下載的壓縮檔用同一套名稱
export function outputName(file: TrayFile, index: number): string {
  return `gears-${index + 1}.${extension(file.name, file.versions.at(-1)!.format)}`;
}

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

// 加密檔留著原本的副檔名（gears-1.csv.age）。只寫 .age 的話，解密時看不出原本是什麼檔案，
// CSV、TXT 這類從內容判斷不出格式的會變成 .bin，手機打不開（2026-10-19 的使用回饋）
function encryptedExtension(file: TrayFile): string {
  const before = file.versions.at(-2);
  if (before) return `${extension(file.name, before.format)}.age`;
  // 加入時就是加密檔，名稱裡有原本的副檔名才留著
  const inner = /\.([a-z0-9]{1,5})\.age$/i.exec(file.name)?.[1];
  return inner ? `${inner.toLowerCase()}.age` : EXTENSION.age;
}

// 暫存區裡第幾個檔案就叫 gears-第幾個，單檔下載與一次下載的壓縮檔用同一套名稱
export function outputName(file: TrayFile, index: number): string {
  const format = file.versions.at(-1)!.format;
  return `gears-${index + 1}.${format === "age" ? encryptedExtension(file) : extension(file.name, format)}`;
}

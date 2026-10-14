import qrcode from "qrcode-generator";
import { encodeBilevelPng } from "../../core/png-encode.ts";

// QR code 產生器的純邏輯，介面在 src/ui/QrTool.tsx。
//
// 編碼交給 qrcode-generator。編碼寫錯的典型後果是產生一個掃得出來、內容卻錯的
// 碼，所以用成熟的實作，測試再把產生的圖解碼回文字比對（tests/unit/qrcode.spec.ts）。

export type Ecc = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  size: number;
  dark: boolean[]; // size × size，逐列排列
}

export class QrTooLong extends Error {
  constructor() {
    super("too long");
    this.name = "QrTooLong";
  }
}

// 函式庫的 Byte 模式把字串的每個字元當成一個位元組（Latin-1），中文直接傳進去會
// 變成亂碼。先轉成 UTF-8，再把每個位元組寫成一個字元交給它。
export function encodeQr(text: string, ecc: Ecc): QrMatrix {
  let binary = "";
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  const qr = qrcode(0, ecc);
  qr.addData(binary, "Byte");
  try {
    qr.make();
  } catch {
    throw new QrTooLong();
  }
  const size = qr.getModuleCount();
  const dark: boolean[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark.push(qr.isDark(r, c));
  return { size, dark };
}

export const MARGIN = 4; // 規格要求四格寬的白邊

export function qrPath(m: QrMatrix): string {
  let d = "";
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.dark[r * m.size + c]) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
    }
  }
  return d;
}

export function qrSvg(m: QrMatrix): string {
  const n = m.size + MARGIN * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path d="${qrPath(m)}" fill="#000"/></svg>`
  );
}

// 每格放大成 scale × scale 個像素
export function qrPng(m: QrMatrix, scale = 10): Uint8Array {
  const n = (m.size + MARGIN * 2) * scale;
  return encodeBilevelPng(n, n, (x, y) => {
    const c = Math.floor(x / scale) - MARGIN;
    const r = Math.floor(y / scale) - MARGIN;
    return c >= 0 && r >= 0 && c < m.size && r < m.size && m.dark[r * m.size + c]!;
  });
}

// Wi-Fi 的 QR code 格式，手機相機掃到會直接詢問要不要連線。
// 反斜線、分號、逗號、冒號與雙引號要跳脫。
export type WifiSecurity = "WPA" | "WEP" | "nopass";

export function wifiPayload(opts: { ssid: string; password: string; security: WifiSecurity; hidden: boolean }): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
  let text = `WIFI:T:${opts.security};S:${esc(opts.ssid)};`;
  if (opts.security !== "nopass") text += `P:${esc(opts.password)};`;
  if (opts.hidden) text += "H:true;";
  return `${text};`;
}

// 面對面傳送的傳輸協定：資料通道上的訊息格式與檢查。純邏輯，有單元測試。
//
// 一條有序、可靠的資料通道。文字訊息是 JSON，二進位訊息是檔案的內容，兩種混在同一條通道裡，
// 到達的順序跟送出的順序相同，所以資料塊不必帶位置：
//
//   送出端 → {"t":"files","files":[{name,size,type,sha256}…]}
//   接收端 → {"t":"accept"} 或 {"t":"decline"}
//   送出端 → {"t":"file","i":0}、資料塊…、{"t":"end","i":0}，每個檔案依序送
//   接收端 → {"t":"done","ok":[true,…]}，每個檔案的 SHA-256 對不對得上

import { sha256 } from "@noble/hashes/sha2.js";

// 每塊 64 KB：各瀏覽器的 max-message-size 都容得下（Safari 與 Chrome 是 256 KB），
// 文件站的實測（anoni-net/docs#553）64 KB 與 256 KB 的速度沒有差別
export const CHUNK = 64 * 1024;

// 接收端的檔案放在記憶體裡。iPhone 分頁的記憶體上限比桌機低，先抓 1 GB，量過再調
export const MAX_TOTAL = 1024 ** 3;

// 一次最多幾個檔案，畫面上的清單也不會太長
export const MAX_FILES = 50;

export interface FileMeta {
  name: string;
  size: number;
  type: string;
  sha256: string; // 十六進位
}

export type Message =
  | { t: "files"; files: FileMeta[] }
  | { t: "accept" }
  | { t: "decline" }
  | { t: "file"; i: number }
  | { t: "end"; i: number }
  | { t: "done"; ok: boolean[] };

const isInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

// 對方送來的訊息先檢查格式，不合的一律當成錯誤，不拿去用
export function parseMessage(text: string): Message {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    throw new Error("bad-message");
  }
  if (!m || typeof m !== "object") throw new Error("bad-message");
  switch (m.t) {
    case "files": {
      const files = m.files;
      if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw new Error("bad-message");
      for (const f of files) {
        if (
          !f || typeof f !== "object" ||
          typeof f.name !== "string" || !f.name || f.name.length > 255 || /[\\/\u0000-\u001f]/.test(f.name) ||
          !isInt(f.size) || typeof f.type !== "string" || f.type.length > 255 ||
          typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)
        )
          throw new Error("bad-message");
      }
      return { t: "files", files: files.map((f) => ({ name: f.name, size: f.size, type: f.type, sha256: f.sha256 })) };
    }
    case "accept":
    case "decline":
      return { t: m.t };
    case "file":
    case "end":
      if (!isInt(m.i, MAX_FILES)) throw new Error("bad-message");
      return { t: m.t, i: m.i };
    case "done":
      if (!Array.isArray(m.ok) || !m.ok.every((v) => typeof v === "boolean")) throw new Error("bad-message");
      return { t: "done", ok: m.ok as boolean[] };
    default:
      throw new Error("bad-message");
  }
}

export const totalSize = (files: FileMeta[]) => files.reduce((sum, f) => sum + f.size, 0);

// 確認碼：兩邊的 DTLS 指紋排序之後接起來取 SHA-256，換成 6 位數字。兩台裝置算出來的一樣，
// 描述在交換途中被換掉的話，指紋不同、確認碼就對不上。用 QR code 面對面交換時，鏡頭對螢幕
// 這條管道換不掉指紋；複製貼上可能經過別人的伺服器，要靠這組數字核對
export function confirmCode(a: Uint8Array, b: Uint8Array): string {
  const [x, y] = compare(a, b) <= 0 ? [a, b] : [b, a];
  const joined = new Uint8Array(x.length + y.length);
  joined.set(x);
  joined.set(y, x.length);
  const h = sha256(joined);
  const n = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  const digits = String(n % 1_000_000).padStart(6, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

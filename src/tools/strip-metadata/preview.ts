import type { Finding } from "../../core/tool.ts";

// 「其他程式自訂的欄位」也把內容列出來。廠商的私有區段常藏著序號、帳號或裝置的識別碼，
// 只寫「有一個自訂欄位」，讀者沒有辦法判斷它會不會透露身分。
//
// 文字直接顯示。二進位資料抽出連續 4 個字元以上的可讀字串（跟 strings 指令一樣），
// 抽不到就顯示開頭的 16 個位元組。

const MAX = 60;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX ? `${flat.slice(0, MAX)}…` : flat;
}

const hex = (bytes: Uint8Array) =>
  [...bytes.subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join(" ") + (bytes.length > 16 ? " …" : "");

export function preview(data: Uint8Array | string): string {
  if (typeof data === "string") return clip(data);
  if (!data.length) return "";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, 4096)).replace(/\0+$/, "");
    // 控制字元很少才當成文字
    const control = [...text].filter((c) => c < " " && c !== "\n" && c !== "\r" && c !== "\t").length;
    if (text && control <= text.length / 20) return clip(text);
  } catch {
    // 不是 UTF-8，往下抽可讀的字串
  }
  const runs = new TextDecoder("latin1").decode(data.subarray(0, 65536)).match(/[\x20-\x7e]{4,}/g);
  return runs ? clip(runs.join(" ")) : hex(data);
}

// 名稱加上內容，例如「APP5: VENDOR-SECRET」
export function other(label: string, data?: Uint8Array | string): Finding {
  const value = data === undefined ? "" : preview(data);
  return { code: "other", value: value ? `${label}: ${value}` : label };
}

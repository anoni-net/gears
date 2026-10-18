import { useEffect, useRef } from "preact/hooks";
import type { Format } from "../core/bytes.ts";
import models from "../tools/transcribe/models.json" with { type: "json" };
import { toolIds } from "../tools/index.ts";
import { QR_KINDS, QR_MODES } from "../tools/qrcode/formats.ts";
import { TASKS } from "./tasks.ts";
import { ANALYTICS_ENDPOINT, ANALYTICS_WEBSITE } from "./analytics-endpoint.ts";
import { IS_ONION } from "../site.ts";

// 使用統計：送到社群自架的 Umami（aa.anoni.net，網站 anoni-net-gears），看讀者打開哪些工具、
// 有沒有處理完、在哪裡失敗。不載入 Umami 的 script，由這裡直接送到 /api/send，CSP 也只開這個網址。
//
// 每個事件只能帶 EVENTS 列出的欄位與值，對不上就整筆不送。檔名、大小、檔案內容、讀者輸入的
// 文字、網址檢查的網址、信件的網域、查證的結果一律不送。頁面瀏覽只送路徑，不含查詢字串，
// referrer 只送網域，螢幕尺寸取到百位數。
//
// 不送的情況：不在 anoni.net 上（本機預覽與測試）、瀏覽器開了 Do Not Track 或 Global Privacy
// Control、讀者在頁尾選了不要記錄（存在這個瀏覽器的 localStorage）。送不出去就算了，不重試。
// onion 版完全不送，建置時整段拿掉（src/site.ts）。

const HOST = "anoni.net";
const OPT_OUT = "gears-analytics-off";

export type FileKind = "image" | "document" | "pdf" | "media" | "archive" | "email" | "other";

const KINDS: Record<string, FileKind> = {
  jpeg: "image",
  png: "image",
  heic: "image",
  avif: "image",
  gif: "image",
  webp: "image",
  tiff: "image",
  bmp: "image",
  pnm: "image",
  svg: "image",
  jxl: "image",
  docx: "document",
  xlsx: "document",
  pptx: "document",
  docm: "document",
  xlsm: "document",
  pptm: "document",
  odt: "document",
  ods: "document",
  odp: "document",
  odg: "document",
  epub: "document",
  html: "document",
  pdf: "pdf",
  mp3: "media",
  m4a: "media",
  mp4: "media",
  mov: "media",
  wav: "media",
  avi: "media",
  flac: "media",
  ogg: "media",
  opus: "media",
  mkv: "media",
  webm: "media",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  torrent: "archive",
  eml: "email",
};

export const fileKind = (format: Format): FileKind => KINDS[format] ?? "other";

// not-found 是讀取 QR code 時圖片裡找不到，canvas-blocked 是瀏覽器不讓讀取 canvas（Tor Browser，見 canvas-access.ts），
// wasm-unavailable 是瀏覽器關掉了 WebAssembly（鎖定模式，見 wasm.ts）
export type FailReason = "unsupported" | "broken" | "too-large" | "encrypted" | "not-found" | "network" | "stalled" | "canvas-blocked" | "wasm-unavailable" | "other";

const REASONS: FailReason[] = ["unsupported", "broken", "too-large", "encrypted", "not-found", "network", "stalled", "canvas-blocked", "wasm-unavailable", "other"];

// 事件與每個欄位允許的值
export const EVENTS: Record<string, Record<string, readonly string[]>> = {
  task: { task: TASKS.map((task) => task.id) },
  "file-add": { kind: ["image", "document", "pdf", "media", "archive", "email", "other"] },
  "tool-done": { tool: toolIds },
  // tray 是加入暫存區時就讀不了的檔案
  "tool-fail": { tool: [...toolIds, "tray"], reason: REASONS },
  save: { how: ["download", "share", "zip"] },
  transcribe: { model: Object.keys(models), device: ["cpu", "gpu"], fallback: ["0", "1"] },
  // QR code 的格式：產生時放進暫存區或下載才記，讀取時讀到才記，內容一律不送
  "qr-make": { format: QR_MODES },
  "qr-read": { format: QR_KINDS },
};

// 欄位剛好是列出的那幾個、值也在清單裡才回傳，其他一律 null
export function scrub(name: string, data: Record<string, string>): Record<string, string> | null {
  const spec = EVENTS[name];
  if (!spec) return null;
  const keys = Object.keys(spec);
  if (Object.keys(data).length !== keys.length) return null;
  for (const key of keys) {
    if (!Object.hasOwn(data, key) || !spec[key]!.includes(data[key]!)) return null;
  }
  return { ...data };
}

// 螢幕尺寸取到百位數，夠分辨裝置類型，又不會成為指紋
export function coarseScreen(width: number, height: number): string {
  const floor = (n: number) => Math.max(100, Math.floor(n / 100) * 100);
  return `${floor(width)}x${floor(height)}`;
}

// 同站的 referrer 不送，其他只留網域
export function referrerHost(referrer: string, self: string): string {
  try {
    const url = new URL(referrer);
    return url.host === self ? "" : `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

export function optedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT) === "1";
  } catch {
    return false;
  }
}

export function setOptedOut(off: boolean) {
  try {
    if (off) localStorage.setItem(OPT_OUT, "1");
    else localStorage.removeItem(OPT_OUT);
  } catch {
    // 存不了（例如無痕模式擋下 localStorage）時，這一頁之內仍然照讀者的選擇
  }
  sessionOff = off;
}

// 瀏覽器要求不追蹤
export function browserDeclines(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

let sessionOff: boolean | null = null;

export function enabled(): boolean {
  if (IS_ONION || location.hostname !== HOST || browserDeclines()) return false;
  return !(sessionOff ?? optedOut());
}

let firstView = true;

function send(extra: { name?: string; data?: Record<string, string> }) {
  if (IS_ONION || !enabled()) return;
  const payload = {
    website: ANALYTICS_WEBSITE,
    hostname: HOST,
    language: navigator.language,
    screen: coarseScreen(screen.width, screen.height),
    url: location.pathname,
    // 只有第一次頁面瀏覽帶 referrer，站內換工具不是從別的網站來的
    referrer: firstView && !extra.name ? referrerHost(document.referrer, location.host) : "",
    ...extra,
  };
  if (!extra.name) firstView = false;
  fetch(ANALYTICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "event", payload }),
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}

// 頁面瀏覽：路徑由 location.pathname 決定，不含查詢字串與 #
export function trackView() {
  send({});
}

export function track(name: string, data: Record<string, string>) {
  const clean = scrub(name, data);
  if (clean) send({ name, data: clean });
}

export function trackFail(tool: string, reason: FailReason) {
  track("tool-fail", { tool, reason });
}

// pdf.js 打不開的 PDF：有開啟密碼的是 PasswordException
export const pdfFailReason = (error: unknown): FailReason => ((error as Error)?.name === "PasswordException" ? "encrypted" : "broken");

// 從空白開始的工具沒有經過暫存區，結果第一次出現時記一次完成，同一個畫面裡不重複記
export function useDoneOnce(tool: string, ready: boolean) {
  const sent = useRef(false);
  useEffect(() => {
    if (!ready || sent.current) return;
    sent.current = true;
    track("tool-done", { tool });
  }, [ready]);
}

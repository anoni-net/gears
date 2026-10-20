import { VIDEO_FORMATS, isMedia } from "../core/bytes.ts";
import type { CreateTool, EditorTool, Tool } from "../core/tool.ts";
import { stripMetadata } from "./strip-metadata/index.ts";
import { STREAMABLE } from "./transcribe/sources.ts";
import { CHECK_FORMATS } from "./doc-check/index.ts";

// 工作台上的所有工具。新增工具時加在這裡，暫存區不必改。
// 這份清單只有純邏輯，網頁版與之後的瀏覽器擴充套件共用，介面元件另外登記在
// src/ui/registry.ts。

// 處理檔案的工具
export const fileTools: Tool[] = [stripMetadata];

// 需要編輯畫面的檔案工具
export const editorTools: EditorTool[] = [
  {
    id: "redact",
    resolves: [],
    // 瀏覽器解碼得了的格式，HEIC 由 libheif 解碼，PDF 由 pdf.js 一頁一頁畫成圖片
    accepts: (format) => ["jpeg", "png", "heic", "avif", "webp", "gif", "bmp", "pdf"].includes(format),
  },
  { id: "heic-to-jpeg", resolves: [], accepts: (format) => format === "heic" },
  { id: "pdf-pages", resolves: [], accepts: (format) => format === "pdf" },
  { id: "encrypt", resolves: [], accepts: (format) => format !== "age" },
  { id: "decrypt", resolves: [], accepts: (format) => format === "age" },
  // 瀏覽器解碼得了聲音的錄音與影片，解碼不了時畫面上說明。可以分段解碼的格式不限大小
  { id: "transcribe", resolves: [], accepts: isMedia, acceptsLarge: (format) => STREAMABLE.includes(format) },
  // 照片縮成常見尺寸並重新壓縮，原始解析度與壓縮設定不再透露手機機型
  { id: "blend", resolves: [], accepts: (format) => ["jpeg", "heic", "avif", "webp"].includes(format) },
  // 列印文件的追蹤點：拍照或掃描的紙本，去掉淡黃色的小點或轉成黑白
  { id: "print-dots", resolves: [], accepts: (format) => ["jpeg", "png", "heic", "avif", "webp", "gif", "bmp", "pdf"].includes(format) },
  // 影片的關鍵影格：挑出畫面明顯不同的幾格，加進暫存區拿去做反向圖片搜尋。瀏覽器從檔案
  // 直接讀，不必整個讀進記憶體，所以不限大小。解不開的格式（AVI、Firefox 的 HEVC）畫面上說明
  { id: "video-frames", resolves: [], accepts: (format) => VIDEO_FORMATS.includes(format), acceptsLarge: (format) => VIDEO_FORMATS.includes(format) },
  // 收到的文件打開時會不會連到外面、執行程式，PDF 可以轉成只有圖片的安全版本
  { id: "doc-check", resolves: [], accepts: (format) => CHECK_FORMATS.includes(format) },
];

// 從空白開始的工具
export const createTools: CreateTool[] = [
  { id: "qrcode", output: "file" },
  { id: "url-check", output: "text" },
  { id: "qr-read", output: "text" },
  { id: "passphrase", output: "text" },
  { id: "age-keygen", output: "text" },
  { id: "text-crypt", output: "text" },
  { id: "verify", output: "file", tray: true },
  { id: "email-check", output: "text" },
  { id: "writing-style", output: "text" },
  { id: "software-verify", output: "text" },
  // 面對面傳送：兩台裝置在同一個網路裡用 WebRTC 直接傳暫存區的檔案，收到的檔案放進暫存區
  { id: "nearby", output: "file", tray: true },
  // 遠端傳送：對方不在身邊時，經過社群的轉送服務傳暫存區的檔案，兩端之間加密，收到的檔案放進暫存區
  { id: "remote", output: "file", tray: true },
];

export const toolIds = [...fileTools, ...editorTools, ...createTools].map((t) => t.id);

export { stripMetadata };

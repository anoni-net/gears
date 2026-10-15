import { isMedia } from "../core/bytes.ts";
import type { CreateTool, EditorTool, Tool } from "../core/tool.ts";
import { stripMetadata } from "./strip-metadata/index.ts";

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
    // 瀏覽器解碼得了的格式，HEIC 由 libheif 解碼
    accepts: (format) => ["jpeg", "png", "heic", "avif", "webp", "gif", "bmp"].includes(format),
  },
  { id: "heic-to-jpeg", resolves: [], accepts: (format) => format === "heic" },
  { id: "encrypt", resolves: [], accepts: (format) => format !== "age" },
  { id: "decrypt", resolves: [], accepts: (format) => format === "age" },
  // 瀏覽器解碼得了聲音的錄音與影片，解碼不了時畫面上說明
  { id: "transcribe", resolves: [], accepts: isMedia },
];

// 從空白開始的工具
export const createTools: CreateTool[] = [
  { id: "qrcode", output: "file" },
  { id: "url-check", output: "text" },
  { id: "qr-read", output: "text" },
  { id: "passphrase", output: "text" },
  { id: "age-keygen", output: "text" },
  { id: "text-crypt", output: "text" },
];

export const toolIds = [...fileTools, ...editorTools, ...createTools].map((t) => t.id);

export { stripMetadata };

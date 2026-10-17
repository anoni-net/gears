import type { Format } from "./bytes.ts";

// 每個工具都實作同一個介面：宣告能處理哪些格式，輸入位元組，輸出新的位元組與
// 處理報告。介面只用 Uint8Array 與純資料，不碰 DOM，網頁版、Web Worker 與之後
// 的瀏覽器擴充套件都能直接呼叫。畫面上的文字由介面層依 code 翻譯。

// 檔案裡找到、可能透露身分或處境的資訊。value 是給讀者看的原值，例如座標。
export const FINDING_CODES = [
  "location",
  "device",
  "serial",
  "owner",
  "datetime",
  "software",
  "thumbnail",
  "xmp",
  "iptc",
  "comment",
  "text",
  "trailer",
  "path",
  "printer",
  "signature",
  "system-files",
  "other",
  // 以下是文件的內容，清除中繼資料不會改動，列出來提醒讀者
  "doc-comments",
  "revisions",
  "attachments",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

// 註解、追蹤修訂與附加檔案是讀者自己寫進去或放進去的內容，工具不替讀者決定要不要刪
export const CONTENT_FINDINGS: readonly FindingCode[] = ["doc-comments", "revisions", "attachments"];

export interface Finding {
  code: FindingCode;
  value?: string;
}

// 處理報告的一項。拿掉的與保留的分開列，讓讀者看得到每一段的去留。
export const SEGMENT_CODES = [
  "exif",
  "xmp",
  "iptc",
  "comment",
  "mpf",
  "trailer",
  "jfif-thumbnail",
  "app",
  "text",
  "time",
  "other",
  "jfif",
  "icc",
  "adobe",
  "orientation",
  "redaction",
  "pdf-pages",
  "pdf-pages-removed",
  "pdf-pages-kept",
  "pdf-document-level",
  "pdf-links",
  "pdf-fields",
  "pdf-shared-fonts",
  "reencode",
  "print-dots-yellow",
  "print-dots-bw",
  "exif-kept",
  "age-passphrase",
  "age-recipients",
  "age-armor",
  "age-decrypted",
  "heif-image",
  "heic-converted",
  "tiff-tags",
  "tiff-image",
  "svg-metadata",
  "svg-editor",
  "bmp-image",
  "jxl-image",
  "doc-properties",
  "doc-custom",
  "doc-thumbnail",
  "doc-authors",
  "doc-ids",
  "doc-template",
  "doc-paths",
  "doc-printer",
  "doc-signature",
  "doc-images",
  "doc-unused",
  "doc-content",
  "doc-comments-removed",
  "doc-revisions-accepted",
  "media-tags",
  "media-times",
  "media-timed",
  "media-app",
  "media-stream",
  "archive-info",
  "archive-system",
  "archive-files",
  "archive-content",
  "torrent-info",
  "torrent-files",
  "html-meta",
  "html-content",
] as const;

export type SegmentCode = (typeof SEGMENT_CODES)[number];

export interface ReportItem {
  code: SegmentCode;
  bytes?: number;
  count?: number;
}

export interface Report {
  removed: ReportItem[];
  kept: ReportItem[];
  notes?: ReportItem[]; // 不屬於拿掉或保留的說明，例如用了哪種方式加密
}

export interface RunResult {
  data: Uint8Array;
  report: Report;
}

// 讀者在畫面上選的處理方式。文件的註解與追蹤修訂是內容，預設保留，讀者勾選才拿掉
export interface RunOptions {
  removeComments?: boolean;
  acceptRevisions?: boolean;
}

// 處理檔案的工具：從暫存區裡的檔案開始，產生新版本。
export interface Tool {
  id: string;
  // 能處理哪幾種找到的資訊。檔案裡有這些資訊時，工具列把這個工具標成建議
  resolves: readonly FindingCode[];
  accepts(format: Format): boolean;
  // 文件類的格式要先解壓縮或載入 pdf-lib，所以兩者都可以是非同步的
  inspect(data: Uint8Array, format: Format): Finding[] | Promise<Finding[]>;
  run(data: Uint8Array, format: Format, options?: RunOptions): RunResult | Promise<RunResult>;
  // 太大、不能一次讀進記憶體的檔案（例如好幾 GB 的影片）。支援的格式才有，只讀需要的部分
  acceptsLarge?(format: Format): boolean;
  inspectLarge?(blob: Blob, format: Format): Promise<Finding[]>;
  runLarge?(blob: Blob, format: Format): Promise<{ blob: Blob; report: Report }>;
}

// 超過這個大小就不整個讀進記憶體，只交給支援大檔案的工具
export const LARGE_FILE = 256 * 1024 * 1024;

// 需要編輯畫面的檔案工具，例如遮蔽：讀者在畫面上操作，結果由介面產生之後交給
// 暫存區（tray.addVersion）。編輯畫面登記在 src/ui/registry.tsx。
export interface EditorTool {
  id: string;
  resolves: readonly FindingCode[];
  accepts(format: Format): boolean;
  // 超過 LARGE_FILE 的檔案也能處理（逐字稿分段解碼），沒有的話大檔案不提供
  acceptsLarge?(format: Format): boolean;
}

// 從空白開始的工具：讀者在工具裡填寫，產出檔案或文字。產出的檔案放進暫存區，
// 可以接著交給處理檔案的工具。填寫用的介面元件登記在 src/ui/registry.ts。
export interface CreateTool {
  id: string;
  output: "file" | "text";
}

// 檔案結構有問題、無法安全處理時丟出。寧可停下來，也不交出一份沒處理乾淨的檔案。
export class ToolError extends Error {
  constructor(readonly reason: "broken" | "unsupported") {
    super(reason);
    this.name = "ToolError";
  }
}

// 同一種資訊出現在多個地方時（例如 EXIF 與 XMP 都有時間）合併成一項，不同的值逐行列出，
// 太多時只列前幾個，後面註明還有幾項
const MAX_VALUES = 8;

export function mergeFindings(findings: Finding[]): Finding[] {
  const merged = new Map<FindingCode, string[]>();
  for (const finding of findings) {
    const values = merged.get(finding.code) ?? [];
    if (finding.value && !values.includes(finding.value)) values.push(finding.value);
    merged.set(finding.code, values);
  }
  return [...merged].map(([code, values]) => {
    if (!values.length) return { code };
    const shown = values.slice(0, MAX_VALUES);
    if (values.length > MAX_VALUES) shown.push(`… +${values.length - MAX_VALUES}`);
    return { code, value: shown.join("\n") };
  });
}

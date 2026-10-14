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
  "other",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

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
  "reencode",
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
}

export interface RunResult {
  data: Uint8Array;
  report: Report;
}

// 處理檔案的工具：從暫存區裡的檔案開始，產生新版本。
export interface Tool {
  id: string;
  // 能處理哪幾種找到的資訊。檔案裡有這些資訊時，工具列把這個工具標成建議
  resolves: readonly FindingCode[];
  accepts(format: Format): boolean;
  inspect(data: Uint8Array, format: Format): Finding[];
  run(data: Uint8Array, format: Format): RunResult;
}

// 需要編輯畫面的檔案工具，例如遮蔽：讀者在畫面上操作，結果由介面產生之後交給
// 暫存區（tray.addVersion）。編輯畫面登記在 src/ui/registry.tsx。
export interface EditorTool {
  id: string;
  resolves: readonly FindingCode[];
  accepts(format: Format): boolean;
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

// 同一種資訊出現在多個地方時（例如 EXIF 與 XMP 都有時間）合併成一項。
export function mergeFindings(findings: Finding[]): Finding[] {
  const merged = new Map<FindingCode, Finding>();
  for (const finding of findings) {
    const existing = merged.get(finding.code);
    if (!existing) {
      merged.set(finding.code, { ...finding });
    } else if (finding.value && !existing.value) {
      existing.value = finding.value;
    }
  }
  return [...merged.values()];
}

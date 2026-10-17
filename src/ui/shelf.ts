import type { Format } from "../core/bytes.ts";
import type { FindingCode } from "../core/tool.ts";
import type { TrayFile, Version } from "../core/tray.ts";
import { editorTools, fileTools } from "../tools/index.ts";
import { signedName } from "../tools/software-verify/signature.ts";
import { type GroupId, TOOL_GROUPS, groupOf } from "./tool-meta.ts";

// 檔案畫面的工具列表（src/ui/FileView.tsx）。列出能處理這個檔案的工具，照桌面的三組排列，
// 依讀者加入檔案時在做的事決定哪一組在前面，再挑出最多兩個建議，每個建議附上理由。
// 這裡只用已經算好的資料（格式、找到的資訊、加入時的目的與 Signals），不讀檔案，有單元測試。

// 讀檔案結構才知道的訊號，由 src/ui/shelf-signals.ts 在打開檔案時算一次
export interface Signals {
  docCheck?: { connect: number; code: number }; // 文件打開時會連線的位址與會執行的程式
  pdfRevisions?: number; // PDF 裡的舊版本
  signature?: boolean; // 這個檔案是 OpenPGP 簽章
}

// 建議的理由。key 是 shelf.reason.* 的字串，findings 是要列出的資訊
export interface Reason {
  key: string;
  n?: number;
  findings?: FindingCode[];
}

export interface ShelfEntry {
  id: string;
  kind: "file" | "editor" | "create";
  // 處理檔案的工具（清除中繼資料）有東西可以處理。沒有時不顯示按鈕
  actionable: boolean;
  applied: boolean;
  reason?: Reason;
}

export interface ShelfGroup {
  id: GroupId;
  entries: ShelfEntry[];
}

export interface ShelfInput {
  file: TrayFile;
  others: TrayFile[]; // 暫存區裡的其他檔案，用來找成對的簽章檔
  preferred?: string; // 從工具的網址進來時，那個工具
  signals: Signals;
}

const MACRO_FORMATS: readonly Format[] = ["docm", "xlsm", "pptm"];
const CAMERA_FORMATS: readonly Format[] = ["jpeg", "heic", "avif", "webp"];
// 理由裡列得出名字的資訊，其他的寫成「中繼資料」
const NAMED_FINDINGS: readonly FindingCode[] = ["location", "device", "serial", "owner", "path", "printer", "datetime", "software"];
const CLUES: readonly FindingCode[] = ["datetime", "device", "location", "software", "owner", "serial"];
const MAX_RECOMMENDED = 2;

// 從空白開始、但也能接收暫存區檔案的工具。打開時把檔案帶過去（見 FileView 的 openWithFile）
function createAccepts(id: string, file: TrayFile, current: Version, signals: Signals, signaturePair: boolean): boolean {
  const original = file.versions[0]!;
  switch (id) {
    case "verify":
      return original.tool === null && current.format !== "age";
    case "email-check":
      return current.format === "eml" && !current.large;
    case "software-verify":
      return !!signals.signature || signaturePair || current.format === "unknown";
    default:
      return false;
  }
}

function usable(tool: { accepts(f: Format): boolean; acceptsLarge?(f: Format): boolean }, current: Version) {
  return current.large ? !!tool.acceptsLarge?.(current.format) : tool.accepts(current.format);
}

// 讀者加入檔案時沒有指定目的，看格式猜：信件、有巨集的文件、簽章檔多半是收到的
function leadGroup({ file, preferred, signals }: ShelfInput, current: Version): GroupId | undefined {
  const fromRoute = preferred ? groupOf(preferred) : undefined;
  if (fromRoute) return fromRoute;
  if (file.intent) return file.intent;
  if (current.format === "eml" || MACRO_FORMATS.includes(current.format) || signals.signature) return "check";
  return undefined;
}

export function buildShelf(input: ShelfInput): ShelfGroup[] {
  const { file, others, preferred, signals } = input;
  const current = file.versions.at(-1)!;
  const original = file.versions[0]!;
  const applied = (id: string) => file.versions.some((v) => v.tool === id);
  const signaturePair = others.some((o) => o.id !== file.id && signedName(o.name) === file.name && o.name !== file.name);
  const found = new Set(current.findings.map((f) => f.code));

  const entries = new Map<string, ShelfEntry>();
  for (const tool of fileTools) {
    if (!usable(tool, current)) continue;
    const actionable = tool.resolves.some((code) => found.has(code));
    entries.set(tool.id, { id: tool.id, kind: "file", actionable, applied: applied(tool.id) });
  }
  for (const tool of editorTools) {
    if (usable(tool, current)) entries.set(tool.id, { id: tool.id, kind: "editor", actionable: true, applied: applied(tool.id) });
  }
  for (const id of ["verify", "email-check", "software-verify"]) {
    if (createAccepts(id, file, current, signals, signaturePair)) entries.set(id, { id, kind: "create", actionable: true, applied: false });
  }

  const lead = leadGroup(input, current);
  const receiving = lead === "check";

  // 建議，依優先順序。安全相關的（打開時會連線、信件、簽章）不看目的，其他的看讀者在做什麼：
  // 檢查收到的檔案時不建議清除中繼資料，那會把查證要用的線索清掉
  const rules: [string, () => Reason | undefined][] = [
    [
      "doc-check",
      () => {
        const d = signals.docCheck;
        if (d?.connect) return { key: "doc-connect", n: d.connect };
        if (d?.code || MACRO_FORMATS.includes(current.format)) return { key: "doc-code" };
        return undefined;
      },
    ],
    ["email-check", () => (current.format === "eml" ? { key: "email" } : undefined)],
    ["software-verify", () => (signals.signature ? { key: "signature-file" } : signaturePair ? { key: "signature-pair" } : undefined)],
    [
      "strip-metadata",
      () => {
        if (receiving || !entries.get("strip-metadata")?.actionable) return undefined;
        const named = NAMED_FINDINGS.filter((code) => found.has(code)).slice(0, 2);
        return named.length ? { key: "strip", findings: named } : { key: "strip-other" };
      },
    ],
    [
      "verify",
      () => {
        if (!receiving) return undefined;
        if (signals.pdfRevisions) return { key: "verify-revisions", n: signals.pdfRevisions };
        return original.findings.some((f) => CLUES.includes(f.code)) ? { key: "verify-clues" } : undefined;
      },
    ],
    ["heic-to-jpeg", () => (!receiving && current.format === "heic" && !applied("heic-to-jpeg") ? { key: "heic" } : undefined)],
    [
      "blend",
      () =>
        !receiving && CAMERA_FORMATS.includes(current.format) && original.findings.some((f) => f.code === "device") && !applied("blend")
          ? { key: "blend" }
          : undefined,
    ],
  ];
  const priority: string[] = [];
  for (const [id, rule] of rules) {
    const entry = entries.get(id);
    if (!entry || priority.length >= MAX_RECOMMENDED) continue;
    const reason = rule();
    if (!reason) continue;
    entry.reason = reason;
    priority.push(id);
  }

  const groupOrder: GroupId[] = TOOL_GROUPS.map((g) => g.id);
  if (lead) groupOrder.sort((a, b) => Number(b === lead) - Number(a === lead));
  return groupOrder
    .map((gid) => {
      const order = TOOL_GROUPS.find((g) => g.id === gid)!.tools as readonly string[];
      const rank = (id: string) => (id === preferred ? -1000 : priority.includes(id) ? -100 + priority.indexOf(id) : order.indexOf(id));
      const list = order.filter((id) => entries.has(id)).sort((a, b) => rank(a) - rank(b));
      return { id: gid, entries: list.map((id) => entries.get(id)!) };
    })
    .filter((g) => g.entries.length);
}

import { EXTENSION, type Format } from "../../core/bytes.ts";
import type { Evidence, PersonRole, TimeEntry } from "./examine.ts";
import type { TimeValue } from "./times.ts";

// 把一批檔案的線索放在一起：時間排成一條線、同一個值出現在哪些檔案，再比對出需要留意的
// 地方。每一項都描述檔案裡寫了什麼，不判斷真假：中繼資料很容易改，有矛盾不代表造假，
// 沒有矛盾也不代表是真的。

export interface CaseFile {
  index: number; // 從 1 開始，畫面與匯出的紀錄都用「檔案 1」稱呼
  name: string;
  format: Format;
  size: number;
  hash?: string;
  evidence: Evidence;
}

export interface Group {
  value: string;
  files: number[];
}

export type WarningCode =
  | "duplicate"
  | "extension-mismatch"
  | "modified-before-created"
  | "gps-time-mismatch"
  | "editing-software"
  | "signed-then-modified"
  | "pdf-revisions"
  | "email-auth-failed"
  | "email-reply-to"
  | "email-display-name"
  | "email-date-skew"
  | "email-attachment"
  | "email-remote-content"
  | "doc-connects"
  | "doc-code";

export interface Warning {
  code: WarningCode;
  files: number[];
  value?: string;
  other?: string;
  times?: [TimeValue, TimeValue]; // 互相矛盾的兩個時間，畫面上依語系寫出
}

export interface Summary {
  timeline: (TimeEntry & { file: number })[];
  devices: Group[];
  serials: Group[];
  software: Group[];
  people: (Group & { role: PersonRole })[];
  locations: { lat: number; lon: number; file: number }[];
  warnings: Warning[];
}

function group(files: CaseFile[], values: (f: CaseFile) => string[]): Group[] {
  const map = new Map<string, number[]>();
  for (const f of files) for (const v of values(f)) map.set(v, [...(map.get(v) ?? []), f.index].filter((n, i, a) => a.indexOf(n) === i));
  // 出現在越多檔案的排越前面
  return [...map].map(([value, list]) => ({ value, files: list })).sort((a, b) => b.files.length - a.files.length);
}

// 副檔名的其他寫法
const ALIASES: Partial<Record<Format, string[]>> = {
  jpeg: ["jpg", "jpeg", "jpe", "jfif"],
  tiff: ["tif", "tiff"],
  heic: ["heic", "heif", "hif"],
  html: ["html", "htm", "xhtml"],
  pnm: ["pnm", "ppm", "pgm", "pbm"],
  mov: ["mov", "qt"],
  mp4: ["mp4", "m4v"],
  ogg: ["ogg", "oga", "ogv"],
  gz: ["gz", "tgz"],
};

export function extensionMatches(name: string, format: Format): boolean {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  if (!m || format === "unknown" || format === "age") return true;
  const ext = m[1]!.toLowerCase();
  return ext === EXTENSION[format] || (ALIASES[format] ?? []).includes(ext);
}

// 常見的影像與影片編輯軟體。手機與相機的韌體版本不算
const EDITORS = /photoshop|lightroom|gimp|snapseed|picsart|canva|affinity|pixelmator|facetune|meitu|美圖|醒圖|vsco|capcut|剪映|inshot|premiere|after effects|final cut/i;

// 真實存在的時區（分鐘）：-12 到 +14 的整點，加上不是整點的那幾個
const ZONES = [
  ...Array.from({ length: 27 }, (_, i) => (i - 12) * 60),
  -570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765,
];
// GPS 定位的時間可能比拍攝早幾分鐘
const SLACK = 5;

const hm = (ms: number) => {
  const minutes = Math.round(Math.abs(ms) / 60000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

function fileWarnings(f: CaseFile): Warning[] {
  const out: Warning[] = [];
  const ev = f.evidence;
  if (!extensionMatches(f.name, f.format)) out.push({ code: "extension-mismatch", files: [f.index], value: EXTENSION[f.format] });

  // 修改早於建立：只比較都有時區或都沒有時區的兩筆
  const starts = ev.times.filter((t) => t.kind === "taken" || t.kind === "created" || t.kind === "digitized");
  for (const mod of ev.times.filter((t) => t.kind === "modified")) {
    const start = starts.find((s) => !!s.offset === !!mod.offset && mod.sort < s.sort - 60000);
    if (start) {
      out.push({ code: "modified-before-created", files: [f.index], times: [mod, start] });
      break;
    }
  }

  // 拍攝時間跟 GPS 時間（UTC）：有時區時直接比；沒有時區時，差距應該接近某個真實的時區
  const taken = ev.times.find((t) => t.kind === "taken" && t.source === "exif");
  const gps = ev.times.find((t) => t.kind === "gps");
  if (taken && gps) {
    const diff = (taken.sort - gps.sort) / 60000;
    const off = taken.offset ? Math.abs(diff) > SLACK : !ZONES.some((z) => Math.abs(diff - z) <= SLACK);
    if (off) out.push({ code: "gps-time-mismatch", files: [f.index], value: hm(diff * 60000) });
  }

  const editor = ev.software.find((s) => EDITORS.test(s));
  if (editor) out.push({ code: "editing-software", files: [f.index], value: editor });
  if (ev.signatures.length && !ev.signatures.some((s) => s.coversWhole)) out.push({ code: "signed-then-modified", files: [f.index] });
  if (ev.revisions.length) out.push({ code: "pdf-revisions", files: [f.index], value: String(ev.revisions.length + 1) });
  if (ev.docCheck?.connect) out.push({ code: "doc-connects", files: [f.index], value: String(ev.docCheck.connect) });
  else if (ev.docCheck?.code) out.push({ code: "doc-code", files: [f.index] });
  if (ev.email) {
    if (ev.email.verdict === "fail") out.push({ code: "email-auth-failed", files: [f.index], value: ev.email.domain });
    for (const n of ev.email.notes) {
      if (n.code === "reply-to") out.push({ code: "email-reply-to", files: [f.index], value: n.value, other: n.other });
      else if (n.code === "display-name") out.push({ code: "email-display-name", files: [f.index], value: n.value, other: n.other });
      else if (n.code === "date-skew") out.push({ code: "email-date-skew", files: [f.index], times: n.times });
      else if (n.code === "dangerous-attachment") out.push({ code: "email-attachment", files: [f.index], value: n.value });
      else if (n.code === "remote-content") out.push({ code: "email-remote-content", files: [f.index], value: n.value });
    }
  }
  return out;
}

export function summarize(files: CaseFile[]): Summary {
  const warnings: Warning[] = [];
  for (const g of group(files, (f) => (f.hash ? [f.hash] : []))) if (g.files.length > 1) warnings.push({ code: "duplicate", files: g.files });
  for (const f of files) warnings.push(...fileWarnings(f));

  const roles: PersonRole[] = ["author", "last-modified-by", "owner", "company", "printed-by", "sender", "reply-to", "recipient"];
  return {
    timeline: files.flatMap((f) => f.evidence.times.map((t) => ({ ...t, file: f.index }))).sort((a, b) => a.sort - b.sort || a.file - b.file),
    devices: group(files, (f) => f.evidence.devices),
    serials: group(files, (f) => f.evidence.serials),
    software: group(files, (f) => f.evidence.software),
    people: roles.flatMap((role) => group(files, (f) => f.evidence.people.filter((p) => p.role === role).map((p) => p.value)).map((g) => ({ ...g, role }))),
    locations: files.flatMap((f) => f.evidence.locations.map((l) => ({ ...l, file: f.index }))),
    warnings,
  };
}

import type { Evidence, TimeEntry } from "./examine.ts";

// 比對 PDF 的兩個版本：文字逐行比對，中繼資料逐項比對。畫面的比對要畫成圖，
// 在 src/ui/pdf-compare.ts。

export interface LineDiff {
  removed: string[]; // 舊版有、新版沒有的行
  added: string[]; // 新版有、舊版沒有的行
}

// 最長共同子序列。一頁的行數不多（幾十到幾百行），直接用二維表
export function diffLines(before: string[], after: string[]): LineDiff {
  const n = before.length;
  const m = after.length;
  if (n * m > 4_000_000) {
    // 太長時退回成集合的比對，順序不看
    const a = new Set(before);
    const b = new Set(after);
    return { removed: before.filter((l) => !b.has(l)), added: after.filter((l) => !a.has(l)) };
  }
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      removed.push(before[i++]!);
    } else {
      added.push(after[j++]!);
    }
  }
  removed.push(...before.slice(i));
  added.push(...after.slice(j));
  return { removed, added };
}

export type MetaField = "created" | "modified" | "software" | "people" | "pages";

export interface MetaChange {
  field: MetaField;
  before?: string;
  after?: string;
}

// 兩個版本的中繼資料，有變的欄位才列出。時間與列舉交給呼叫的人依語系格式化
export function metaChanges(before: Evidence, after: Evidence, fmt: { time(t: TimeEntry): string; list(items: string[]): string }): MetaChange[] {
  const timeOf = (ev: Evidence, kind: TimeEntry["kind"]) => {
    const t = ev.times.filter((x) => x.kind === kind && x.source !== "xmp").at(-1) ?? ev.times.filter((x) => x.kind === kind).at(-1);
    return t ? fmt.time(t) : undefined;
  };
  const out: MetaChange[] = [];
  const cmp = (field: MetaField, a: string | undefined, b: string | undefined) => {
    if ((a ?? "") !== (b ?? "")) out.push({ field, before: a, after: b });
  };
  cmp("created", timeOf(before, "created"), timeOf(after, "created"));
  cmp("modified", timeOf(before, "modified"), timeOf(after, "modified"));
  const join = (items: string[]) => (items.length ? fmt.list(items) : undefined);
  cmp("software", join(before.software), join(after.software));
  const people = (ev: Evidence) => join(ev.people.map((p) => p.value));
  cmp("people", people(before), people(after));
  cmp("pages", before.pages?.toString(), after.pages?.toString());
  return out;
}

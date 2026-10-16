import { AUDIO_FORMATS, EXTENSION, type Format, VIDEO_FORMATS, isPhoto } from "../core/bytes.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
import type { Evidence, TimeEntry } from "../tools/verify/examine.ts";
import type { CaseFile, Group, Summary, Warning } from "../tools/verify/summary.ts";
import type { TimeValue } from "../tools/verify/times.ts";

// 查證紀錄的呈現：畫面與匯出的 Markdown 用同一套說法。順序照讀者想問的：先看有沒有
// 需要留意的地方，再看每個檔案的重點，最後才是檔案之間的關聯與完整的時間線。
// 檔案一律用檔名稱呼，不讓讀者在編號之間對照。

export interface CaseEntry extends CaseFile {
  addedAt: number;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

// 裝置的時鐘，寫出時區，例如 2026-10-16 14:05:09（UTC+08:00）
export function localTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return timeText({ text: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, offset: zone });
}

export const timeText = (v: TimeValue | { text: string; offset?: string }) => t("verify.time", { time: v.text, zone: v.offset ? `UTC${v.offset}` : t("verify.noZone") });

export const kindText = (e: TimeEntry) => (e.note ? t("verify.kindNote", { kind: tDynamic(`verify.kind.${e.kind}`), note: e.note }) : tDynamic(`verify.kind.${e.kind}`));
export const sourceText = (e: TimeEntry) => tDynamic(`verify.source.${e.source}`);

export function typeText(format: Format): string {
  const kind = format === "pdf" ? "pdf" : isPhoto(format) ? "photo" : VIDEO_FORMATS.includes(format) ? "video" : AUDIO_FORMATS.includes(format) ? "audio" : ["docx", "xlsx", "pptx", "odt", "ods", "odp", "odg"].includes(format) ? "document" : "other";
  return tDynamic(`verify.type.${kind}`);
}

// 類型與副檔名，例如「照片 · JPG」。兩者相同時（PDF）只寫一次
export function typeLine(format: Format): string {
  const type = typeText(format);
  const ext = EXTENSION[format].toUpperCase();
  return type === ext ? type : `${type} · ${ext}`;
}

// 卡片上的兩個重點時間：開始（拍攝、建立或檔案記錄的時間）與最後一次修改
export function keyTimes(ev: Evidence): { start?: TimeEntry; modified?: TimeEntry } {
  const pick = (kind: TimeEntry["kind"]) => ev.times.find((x) => x.kind === kind);
  const start = pick("taken") ?? ev.times.find((x) => x.kind === "created" && x.source !== "xmp") ?? pick("created") ?? pick("recorded");
  const modified = ev.times.filter((x) => x.kind === "modified").at(-1);
  return { start, modified: modified && start && modified.text === start.text && modified.offset === start.offset ? undefined : modified };
}

export const names = (files: CaseFile[], indices: number[]) => list(indices.map((i) => files[i - 1]?.name ?? String(i)));

export function warningTitle(w: Warning): string {
  return tDynamic(`verify.warn.${w.code}.title`);
}

export function warningDetail(w: Warning, files: CaseFile[]): string {
  const [value, other] = w.times ? w.times.map(timeText) : [w.value ?? "", ""];
  return tDynamic(`verify.warn.${w.code}.detail`, { files: names(files, w.files), value: value!, other: other! });
}

// 每個檔案的其他痕跡（修訂次數、範本、簽章），畫面與匯出共用
export function traceLines(ev: Evidence): string[] {
  const out: string[] = [];
  for (const trace of ev.traces) {
    if (trace.code === "thumbnail" || trace.code === "pdf-revisions") continue; // 另外顯示
    out.push(tDynamic(`verify.trace.${trace.code}`, { n: trace.count ?? 0, value: trace.value ?? "" }));
  }
  for (const s of ev.signatures) {
    const who = s.name ?? t("verify.unknownSigner");
    out.push(t(s.coversWhole ? "verify.signature.whole" : "verify.signature.partial", { name: who, time: s.time ? timeText(s.time) : "-" }));
  }
  return out;
}

export const peopleText = (ev: Evidence) => list(ev.people.map((p) => t("verify.person", { role: tDynamic(`verify.role.${p.role}`), name: p.value })));

// 出現在兩個以上檔案的裝置、序號、軟體與人名
export function relations(summary: Summary): { label: string; group: Group }[] {
  const out: { label: string; group: Group }[] = [];
  const add = (label: string, groups: Group[]) => {
    for (const g of groups) if (g.files.length > 1) out.push({ label, group: g });
  };
  add(t("verify.device"), summary.devices);
  add(t("verify.serial"), summary.serials);
  add(t("verify.software"), summary.software);
  for (const p of summary.people) if (p.files.length > 1) out.push({ label: tDynamic(`verify.role.${p.role}`), group: p });
  return out;
}

export function overviewText(files: CaseFile[], summary: Summary): string {
  return summary.warnings.length
    ? t("verify.overview", { n: files.length, m: summary.warnings.length })
    : t("verify.overviewClean", { n: files.length });
}

// 匯出的 Markdown。讀者會存檔、交給同事或附在報導的工作紀錄裡，開頭寫清楚是什麼時候、
// 用哪一版的工具產生，每個檔案都附上雜湊值
export function buildReport(files: CaseEntry[], summary: Summary, now: number, commit: string): string {
  const lines: string[] = [];
  const h = (level: number, text: string) => lines.push("", `${"#".repeat(level)} ${text}`, "");
  lines.push(`# ${t("verify.report.title")}`, "");
  lines.push(`- ${t("verify.report.generated")}：${localTime(now)}`);
  lines.push(`- ${t("verify.report.tool")}：anoni.net Gears（${commit}）`);
  lines.push("", t("verify.caveat"), "", overviewText(files, summary));

  if (summary.warnings.length) {
    h(2, t("verify.section.warnings"));
    for (const w of summary.warnings) lines.push(`- **${warningTitle(w)}**：${warningDetail(w, files)}`);
  }

  h(2, t("verify.section.files"));
  for (const f of files) {
    const ev = f.evidence;
    const { start, modified } = keyTimes(ev);
    h(3, f.name);
    lines.push(`- ${t("verify.fact.type")}：${typeLine(f.format)} · ${formatSize(f.size)}`);
    if (start) lines.push(`- ${kindText(start)}：${timeText(start)}`);
    if (modified) lines.push(`- ${t("verify.fact.modified")}：${timeText(modified)}`);
    if (ev.devices.length) lines.push(`- ${t("verify.device")}：${list(ev.devices)}`);
    if (ev.serials.length) lines.push(`- ${t("verify.serial")}：${list(ev.serials)}`);
    if (ev.software.length) lines.push(`- ${t("verify.software")}：${list(ev.software)}`);
    if (ev.people.length) lines.push(`- ${t("verify.fact.people")}：${peopleText(ev)}`);
    for (const l of ev.locations) lines.push(`- ${t("verify.fact.location")}：${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}`);
    if (ev.thumbnail) lines.push(`- ${t("verify.thumbNote")}`);
    if (ev.revisions.length) lines.push(`- ${t("verify.revisions", { n: ev.revisions.length + 1 })}`);
    for (const line of traceLines(ev)) lines.push(`- ${line}`);
    lines.push(`- SHA-256：\`${f.hash ?? "-"}\``);
    lines.push(`- ${t("verify.fact.added")}：${localTime(f.addedAt)}`);
    if (ev.times.length) {
      lines.push(`- ${t("verify.fact.allTimes")}：`);
      for (const e of ev.times) lines.push(`    - ${timeText(e)}：${kindText(e)}（${sourceText(e)}）`);
    }
  }

  const rel = relations(summary);
  if (files.length > 1 && rel.length) {
    h(2, t("verify.section.relations"));
    for (const r of rel) lines.push(`- ${r.label}：${r.group.value}（${names(files, r.group.files)}）`);
  }

  if (files.length > 1 && summary.timeline.length) {
    h(2, t("verify.section.timeline"));
    lines.push(t("verify.timelineNote"), "");
    for (const e of summary.timeline) lines.push(`- ${timeText(e)}：${files[e.file - 1]!.name}，${kindText(e)}（${sourceText(e)}）`);
  }
  return `${lines.join("\n")}\n`;
}

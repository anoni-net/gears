import { EXTENSION } from "../core/bytes.ts";
import { list, t, tDynamic } from "../i18n/index.ts";
import type { TimeEntry } from "../tools/verify/examine.ts";
import type { CaseFile, Summary, Warning } from "../tools/verify/summary.ts";

// 查證紀錄的文字：畫面與匯出的 Markdown 共用同一套說法。

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

export const fileLabel = (n: number) => t("verify.file", { n });
export const filesLabel = (files: number[]) => t("verify.files", { list: list(files.map(String)) });

// 裝置的時鐘，寫出時區，例如 2026-10-16 14:05:09 +08:00
export function localTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${zone}`;
}

export const timeText = (t0: { text: string; offset?: string }) => `${t0.text} ${t0.offset ?? t("verify.noZone")}`;

export function timeLabel(entry: TimeEntry): string {
  const kind = tDynamic(`verify.kind.${entry.kind}`);
  const source = tDynamic(`verify.source.${entry.source}`);
  return entry.note ? `${kind}（${source}，${entry.note}）` : `${kind}（${source}）`;
}

export function warningText(w: Warning): string {
  const [value, other] = w.times ? w.times.map(timeText) : [w.value ?? "", ""];
  return tDynamic(`verify.warn.${w.code}`, { files: filesLabel(w.files), value: value!, other: other! });
}

export const formatName = (f: CaseFile) => EXTENSION[f.format].toUpperCase();

// 匯出的 Markdown。讀者會存檔、交給同事或附在報導的工作紀錄裡，開頭寫清楚是什麼時候、
// 用哪一版的工具產生，接著是可以用來核對的雜湊值
export function buildReport(files: CaseEntry[], summary: Summary, now: number, commit: string): string {
  const lines: string[] = [];
  const h = (text: string) => lines.push("", `## ${text}`, "");
  lines.push(`# ${t("verify.report.title")}`, "");
  lines.push(`- ${t("verify.report.generated")}：${localTime(now)}`);
  lines.push(`- ${t("verify.report.tool")}：anoni.net Gears（${commit}）`);
  lines.push("", t("verify.report.note"));

  h(t("verify.section.files"));
  for (const f of files) {
    lines.push(`### ${fileLabel(f.index)}：${f.name}`, "");
    lines.push(`- ${t("verify.format")}：${formatName(f)}`);
    lines.push(`- ${t("verify.size")}：${formatSize(f.size)}（${f.size.toLocaleString("en")} bytes）`);
    lines.push(`- SHA-256：\`${f.hash ?? "-"}\``);
    lines.push(`- ${t("verify.addedAt")}：${localTime(f.addedAt)}`, "");
  }

  h(t("verify.section.warnings"));
  lines.push(...(summary.warnings.length ? summary.warnings.map((w) => `- ${warningText(w)}`) : [t("verify.none")]));

  h(t("verify.section.timeline"));
  lines.push(...(summary.timeline.length ? summary.timeline.map((e) => `- ${timeText(e)}：${fileLabel(e.file)}，${timeLabel(e)}`) : [t("verify.none")]));

  const groups: [string, { value: string; files: number[] }[]][] = [
    [t("verify.devices"), summary.devices],
    [t("verify.serials"), summary.serials],
    [t("verify.software"), summary.software],
  ];
  h(t("verify.section.devices"));
  const deviceLines = groups.flatMap(([label, items]) => items.map((g) => `- ${label}：${g.value}（${filesLabel(g.files)}）`));
  lines.push(...(deviceLines.length ? deviceLines : [t("verify.none")]));

  h(t("verify.section.people"));
  const people = summary.people.map((p) => `- ${tDynamic(`verify.role.${p.role}`)}：${p.value}（${filesLabel(p.files)}）`);
  lines.push(...(people.length ? people : [t("verify.none")]));

  h(t("verify.section.locations"));
  const places = summary.locations.map((l) => `- ${l.lat.toFixed(5)}, ${l.lon.toFixed(5)}（${fileLabel(l.file)}）`);
  lines.push(...(places.length ? places : [t("verify.none")]));

  h(t("verify.section.traces"));
  const traces = files.flatMap((f) => traceLines(f).map((text) => `- ${fileLabel(f.index)}：${text}`));
  lines.push(...(traces.length ? traces : [t("verify.none")]));
  return `${lines.join("\n")}\n`;
}

// 每個檔案的編輯痕跡，畫面與匯出共用
export function traceLines(f: CaseFile): string[] {
  const ev = f.evidence;
  const out: string[] = [];
  for (const trace of ev.traces) {
    if (trace.code === "thumbnail") out.push(t("verify.trace.thumbnail"));
    else out.push(tDynamic(`verify.trace.${trace.code}`, { n: trace.count ?? 0, value: trace.value ?? "" }));
  }
  for (const s of ev.signatures) {
    const who = s.name ?? t("verify.unknownSigner");
    out.push(t(s.coversWhole ? "verify.signature.whole" : "verify.signature.partial", { name: who, time: s.time ? timeText(s.time) : "-" }));
  }
  return out;
}

// 裝置量測的結果送到社群自架的表單伺服器（Formbricks），做法跟建議與回饋相同（src/feedback.ts），
// 同一個送出網址，CSP 不必另外開。三個語系共用一份問卷，題目 id（device、year、memory、note、report）
// 與兩個 hidden fields（locale、version）照社群工作區的 formbricks/gears_bench_survey.py。
// 選擇題存的是選項的文字，不管介面是哪個語系一律送正體中文，跟那份檔案的選項一字不差，改字時兩邊一起改。
// 收集與整理見 anoni-net/gears#144
import type { Locale } from "./i18n/index.ts";
import type { SurveyPayload } from "./feedback.ts";

export const BENCH_SURVEY = "cmvkre5t7000t01o1697ryiv7";

export const BENCH_DEVICES = { phone: "手機", tablet: "平板", laptop: "筆電", desktop: "桌機" } as const;
export const BENCH_MEMORIES = { "4": "4 GB 以下", "8": "8 GB", "16": "16 GB", "32": "32 GB 以上", unknown: "不知道" } as const;
export type BenchDevice = keyof typeof BENCH_DEVICES;
export type BenchMemory = keyof typeof BENCH_MEMORIES;

// 跟問卷的字數限制相同
export const BENCH_LIMITS = { year: 20, note: 1000, report: 50000 };

export interface BenchAnswers {
  device?: BenchDevice;
  year: string;
  memory?: BenchMemory;
  note: string;
}

export const benchReady = (a: BenchAnswers, report: string) => !!a.device && !!report && report.length <= BENCH_LIMITS.report;

// 沒填的欄位不送
export function benchPayload(a: BenchAnswers, report: string, ctx: { locale: Locale; version: string }): SurveyPayload {
  const data: Record<string, string> = { device: BENCH_DEVICES[a.device!], report, locale: ctx.locale, version: ctx.version };
  if (a.year.trim()) data.year = a.year.trim().slice(0, BENCH_LIMITS.year);
  if (a.memory) data.memory = BENCH_MEMORIES[a.memory];
  if (a.note.trim()) data.note = a.note.trim().slice(0, BENCH_LIMITS.note);
  return { surveyId: BENCH_SURVEY, finished: true, data };
}

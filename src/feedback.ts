// 建議與回饋：讀者在 Gears 裡寫下想要的工具、改進或處理不了的檔案，送到社群自架的表單伺服器
// （Formbricks，form.anoni.net）。表單由 Gears 自己畫，不嵌入 Formbricks 的頁面：整個網站送了
// Cross-Origin-Embedder-Policy: require-corp（逐字稿要用多執行緒），別的網站的頁面嵌不進來，
// 讀者也不必認識另一個服務。送出用 Formbricks 給網頁用的公開 API，不需要金鑰。
//
// Formbricks 那一邊每個語系一份問卷，題目 id（kind、goal、current、frequency、contact）與三個
// hidden fields（tool、locale、version）照社群工作區的 formbricks/gears_survey.py。選擇題存的是
// 選項的文字，所以 feedback.kind.*、feedback.frequency.* 的字串要跟那份檔案的選項一字不差，改字時兩邊一起改。
// onion 版送到 onion 的表單伺服器，讀者不必離開 Tor 網路
import type { Locale } from "./i18n/index.ts";
import { IS_ONION, ONION_HOST } from "./site.ts";

export const FEEDBACK_SURVEYS: Record<Locale, string> = {
  "zh-TW": "cmvd7x9nx000h01o1ore46k5v",
  "zh-CN": "cmvd7xhpq000i01o1aow3g3q5",
  en: "cmvd7xi3z000j01o1o3a5wh32",
};

// Formbricks 專案的 production 環境
const ENVIRONMENT = "cmc9borto0008lj014bq33jqq";

// vite.config.ts 也用這兩個網址寫進 CSP 的 connect-src，只開這一個路徑。分成兩個常數，
// 建置時沒用到的那個會被拿掉，onion 版的產物裡不會有 clearnet 的網址
export const FEEDBACK_ENDPOINT_CLEARNET = `https://form.anoni.net/api/v1/client/${ENVIRONMENT}/responses`;
export const FEEDBACK_ENDPOINT_ONION = `http://form.${ONION_HOST}/api/v1/client/${ENVIRONMENT}/responses`;

export const FEEDBACK_ENDPOINT = IS_ONION ? FEEDBACK_ENDPOINT_ONION : FEEDBACK_ENDPOINT_CLEARNET;

export const FEEDBACK_KINDS = ["new-tool", "improve", "format", "bug", "other"] as const;
export const FEEDBACK_FREQUENCIES = ["daily", "weekly", "monthly", "rarely"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackFrequency = (typeof FEEDBACK_FREQUENCIES)[number];

// 跟問卷的字數限制相同
export const FEEDBACK_LIMITS = { goalMin: 10, goal: 3000, current: 1000, contact: 200 };

export interface Feedback {
  kind: FeedbackKind;
  goal: string;
  current: string;
  frequency?: FeedbackFrequency;
  contact: string;
}

export interface FeedbackContext {
  tool: string; // 從哪個工具過來，桌面是 home
  locale: Locale;
  version: string;
}

export const feedbackReady = (w: Partial<Feedback>) => !!w.kind && (w.goal ?? "").trim().length >= FEEDBACK_LIMITS.goalMin;

// label 把 feedback.kind.* 這類鍵換成該語系的文字。沒填的欄位不送
export function feedbackPayload(w: Feedback, ctx: FeedbackContext, label: (key: string) => string): SurveyPayload {
  const data: Record<string, string> = {
    kind: label(`feedback.kind.${w.kind}`),
    goal: w.goal.trim(),
    tool: ctx.tool || "home",
    locale: ctx.locale,
    version: ctx.version,
  };
  if (w.current.trim()) data.current = w.current.trim();
  if (w.frequency) data.frequency = label(`feedback.frequency.${w.frequency}`);
  if (w.contact.trim()) data.contact = w.contact.trim();
  return { surveyId: FEEDBACK_SURVEYS[ctx.locale], finished: true as const, data };
}

export type FeedbackResult = "sent" | "closed" | "network" | "other";

// 送到 Formbricks 公開 API 的內容。裝置量測的結果（src/bench-submit.ts）也走這裡
export interface SurveyPayload {
  surveyId: string;
  finished: true;
  data: Record<string, string>;
}

// 不帶 cookie 與 Referer，伺服器拿不到讀者在 Gears 裡的網址。問卷沒有開放（草稿或已關閉）時回 403
export async function sendFeedback(payload: SurveyPayload, endpoint = FEEDBACK_ENDPOINT): Promise<FeedbackResult> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } catch {
    return "network";
  }
  if (res.ok) return "sent";
  return res.status === 403 ? "closed" : "other";
}

// 裝置量測的個資辨識（src/ui/PiiBench.tsx）：三段虛構的範例文字與「找到幾個」的計算。
// 模型、詞元對回原文的做法在 src/tools/redact/pii-model.ts，遮蔽與其他工具共用同一份
import type { PiiSpan } from "../redact/pii-model.ts";

// 量測用的三段虛構文字，人名、電話、Email 與地址都是編的，Email 用保留的網域。
// expect 列出應該找到的字，用來確認每種設定找到的一樣（不是評測，評測在社群工作區）
export const PII_SAMPLES = [
  { id: "chat", text: "小美你好，我是林志明，明天下午兩點在松仁路 100 號 3 樓的會議室見，有事打 0912-345-678。", expect: ["小美", "林志明", "松仁路 100 號 3 樓", "0912-345-678"] },
  {
    id: "notice",
    text: "親愛的陳怡君同學：您申請的獎學金已核准，請於 11 月 30 日前攜帶證件到永和高中學務處（承辦人黃建宏，電話 02-2925-1234，信箱 scholarship@example.edu.tw）辦理。",
    expect: ["陳怡君", "永和高中", "黃建宏", "02-2925-1234", "scholarship@example.edu.tw"],
  },
  { id: "mixed", text: "Hi Kevin，報價單寄到 kevin.lin@example.com 了，我的帳號是 nightowl_88，公司是範例科技股份有限公司。", expect: ["Kevin", "kevin.lin@example.com", "nightowl_88", "範例科技股份有限公司"] },
] as const;

export type PiiSampleId = (typeof PII_SAMPLES)[number]["id"];

// 應該找到的字有一半以上被範圍蓋住才算找到
export function foundCount(text: string, expect: readonly string[], spans: PiiSpan[]): number {
  return expect.filter((word) => {
    const at = text.indexOf(word);
    if (at < 0) return false;
    let covered = 0;
    for (let i = at; i < at + word.length; i++) if (spans.some((s) => s.start <= i && i < s.end)) covered++;
    return covered >= word.length / 2;
  }).length;
}


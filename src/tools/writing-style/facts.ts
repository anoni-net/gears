import { findPiiInText } from "../redact/pii.ts";

// 改寫前後必須一樣的事實：數字、引號裡的原話、網址與 Email 這類個資。
// 語言模型改寫時常把「一直賣給第三方」寫成「曾經提供給第三方」、把引述的原話換個說法，
// 意思的改變沒辦法用規則抓，但數字與原話可以：改寫之後少了任何一項，就提醒讀者對照原文。
// 反過來，改寫後多出原文沒有的數字也要提醒，例如把「二十幾家」寫成「二十三家」。

export type FactKind = "number" | "quote" | "pii";

export interface Fact {
  kind: FactKind;
  text: string; // 原文裡的寫法
  key: string; // 比對用的寫法
}

const DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

// 一萬以下的中文數字換成阿拉伯數字，改寫時「三年」寫成「3 年」也算同一件事
function chineseNumber(text: string): number | null {
  let total = 0;
  let digit = 0;
  for (const c of text) {
    if (c in DIGIT) digit = DIGIT[c]!;
    else if (c in UNIT) {
      total += (digit || 1) * UNIT[c]!;
      digit = 0;
    } else if (c === "萬") {
      total = (total + digit) * 10000;
      digit = 0;
    } else return null;
  }
  return total + digit;
}

const halfwidth = (text: string) => text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const normalize = (text: string) => halfwidth(text).replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

// 量詞前面的中文數字才算，「一直」、「一起」裡的「一」不算
const COUNTED = /[零〇一二兩三四五六七八九十百千萬]+(?=年|個|月|天|日|週|周|次|人|位|萬|元|塊|小時|分鐘|分|歲|家|間|份|頁|封|張|件|筆|台|部|名|條|項|層|樓|號)/g;

// 列舉（「一、」）與序數（「第三」）。只在判斷改寫後多出的數字時算進原文，改寫成「1.」、「第 3」不算多出來
const LISTED = /[零〇一二兩三四五六七八九十百千萬]+(?=、)|(?<=第)[零〇一二兩三四五六七八九十百千萬]+/g;

// lenient：「一個」的「一」、列舉與序數也算，用在原文那一邊
function numbersOf(text: string, pii: { start: number; end: number }[], lenient = false): Fact[] {
  const facts: Fact[] = [];
  const inPii = (start: number, end: number) => pii.some((p) => p.start < end && p.end > start);
  const source = halfwidth(text);
  for (const m of source.matchAll(/\d+(?:[.:,／/-]\d+)*/g)) {
    if (inPii(m.index, m.index + m[0].length)) continue;
    facts.push({ kind: "number", text: text.slice(m.index, m.index + m[0].length), key: m[0].replace(/,/g, "") });
  }
  for (const m of [...text.matchAll(COUNTED), ...(lenient ? text.matchAll(LISTED) : [])]) {
    // 「一個」、「一家」多半只是冠詞，改寫時拿掉不算少了事實
    if (m[0] === "一" && !lenient) continue;
    const n = chineseNumber(m[0]);
    if (n !== null) facts.push({ kind: "number", text: m[0], key: String(n) });
  }
  return facts;
}

export function factsOf(text: string): Fact[] {
  const facts: Fact[] = [];
  const pii = findPiiInText(text);
  for (const p of pii) facts.push({ kind: "pii", text: p.text, key: normalize(p.text) });
  facts.push(...numbersOf(text, pii));
  for (const m of text.matchAll(/「([^」]+)」|『([^』]+)』|"([^"\n]+)"|“([^”\n]+)”/g)) {
    const inner = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    if (normalize(inner)) facts.push({ kind: "quote", text: inner, key: normalize(inner) });
  }
  return facts;
}

// 原文的事實在改寫後找不到的
export function missingFacts(original: string, rewritten: string): Fact[] {
  const after = factsOf(rewritten);
  const numbers = new Set(after.filter((f) => f.kind === "number").map((f) => f.key));
  const flat = normalize(rewritten);
  return factsOf(original).filter((fact) => {
    if (fact.kind === "number") return !numbers.has(fact.key);
    // 引號裡的原話與個資：改寫後的文字裡要找得到同樣的內容，引號換了沒關係
    return !flat.includes(fact.key);
  });
}

// 改寫後出現、原文沒有的數字，同一個數字只列一次
export function addedNumbers(original: string, rewritten: string): Fact[] {
  const before = new Set(numbersOf(original, findPiiInText(original), true).map((f) => f.key));
  const seen = new Set<string>();
  return numbersOf(rewritten, findPiiInText(rewritten)).filter((f) => {
    if (before.has(f.key) || seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });
}

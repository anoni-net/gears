import type { Box } from "./index.ts";

// 文字辨識的結果裡，找出看起來像個資的部分：電話、Email、身分證與居留證號碼、
// 信用卡號、長串數字（帳號、訂單編號）、網址與 @帳號。辨識是逐字的，一個電話號碼常被
// 切成好幾個字，所以把同一行的字接起來比對，再把對到的那幾個字的範圍合成一個框。

export type PiiKind = "phone" | "email" | "id" | "card" | "number" | "url" | "handle";

export interface Word {
  text: string;
  box: Box;
}

export interface PiiMatch {
  kind: PiiKind;
  text: string;
  box: Box;
}

// 順序有意義：前面的先比對，對到的字不再給後面的規則
const PATTERNS: [PiiKind, RegExp][] = [
  ["email", /[\w.+-]+@[\w-]+(\.[\w-]+)+/g],
  ["url", /\b(https?:\/\/|www\.)\S+/gi],
  // 台灣的身分證與居留證：英文字母加 9 碼數字
  ["id", /\b[A-Z][12ABCD89]\d{8}\b/g],
  ["card", /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g],
  // 手機（09 開頭）、市話（0 開頭加區碼）、國際碼，以及香港、澳門的 8 碼
  ["phone", /(\+\d{1,3}[ -]?)?\(?0?\d{1,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}/g],
  ["handle", /(^|[^\w])@[A-Za-z0-9_.]{3,}/g],
  ["number", /\d{8,}/g],
];

// 電話的規則比較寬，要有 8 到 12 個數字，避免把日期、金額框起來，更長的交給「長串數字」
const digits = (text: string) => text.replace(/\D/g, "").length;

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

// 一段文字裡的個資，寫作習慣檢查（src/tools/writing-style/）也用這份規則
export function findPiiInText(text: string): { kind: PiiKind; start: number; end: number; text: string }[] {
  const found: { kind: PiiKind; start: number; end: number; text: string }[] = [];
  const taken = (start: number, end: number) => found.some((f) => f.start < end && f.end > start);
  for (const [kind, pattern] of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      let match = m[0];
      let start = m.index;
      if (kind === "handle") {
        const at = match.indexOf("@");
        start += at;
        match = match.slice(at);
      }
      if (kind === "phone" && (digits(match) < 8 || digits(match) > 12)) continue;
      const trimmed = match.trimEnd();
      const end = start + trimmed.length;
      if (taken(start, end)) continue;
      found.push({ kind, start, end, text: trimmed });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function findPii(lines: Word[][]): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const words of lines) {
    // 字與字之間補一個空白，記下每個字在整行裡的位置
    let text = "";
    const spans: [number, number][] = [];
    for (const word of words) {
      if (text) text += " ";
      spans.push([text.length, text.length + word.text.length]);
      text += word.text;
    }
    const used = new Set<number>();
    for (const [kind, pattern] of PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        let found = m[0];
        let start = m.index;
        if (kind === "handle") {
          const at = found.indexOf("@");
          start += at;
          found = found.slice(at);
        }
        if (kind === "phone" && (digits(found) < 8 || digits(found) > 12)) continue;
        const end = start + found.length;
        const hit = spans.map((span, i) => [span, i] as const).filter(([[s, e]]) => s < end && e > start).map(([, i]) => i);
        if (!hit.length || hit.some((i) => used.has(i))) continue;
        hit.forEach((i) => used.add(i));
        matches.push({ kind, text: found.trim(), box: union(hit.map((i) => words[i]!.box)) });
      }
    }
  }
  return matches;
}

// 框往外多留一點，辨識出來的範圍常常剛好貼著字
export function pad(box: Box, ratio: number, width: number, height: number): Box {
  const dx = Math.max(2, box.w * ratio);
  const dy = Math.max(2, box.h * ratio);
  const x = Math.max(0, box.x - dx);
  const y = Math.max(0, box.y - dy);
  return { x, y, w: Math.min(width, box.x + box.w + dx) - x, h: Math.min(height, box.y + box.h + dy) - y };
}

// 跟已經有的框重疊一半以上的不再加
export function overlaps(a: Box, b: Box): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return false;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h) > 0.5;
}

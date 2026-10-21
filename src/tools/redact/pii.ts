import type { Box } from "./index.ts";

// 文字辨識的結果裡，找出看起來像個資的部分：電話、Email、身分證與居留證號碼、
// 信用卡號、長串數字（帳號、訂單編號）、網址與 @帳號。辨識是逐字的，一個電話號碼常被
// 切成好幾個字，所以把同一行的字接起來比對，再把對到的那幾個字的範圍合成一個框。
// 換行把一段個資拆成兩行時，上下兩行再接起來比對一次（findPiiInLineTexts）。

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

// 一行文字與每個位置（UTF-16）的字的範圍，補上的空白是 null。PDF 的文字層（pdf-text.ts）
// 直接是這個格式，辨識的結果由 findPii 從一個一個的字換過來
export interface LineText {
  text: string;
  boxes: (Box | null)[];
}

// 順序有意義：前面的先比對，對到的字不再給後面的規則
const PATTERNS: [PiiKind, RegExp][] = [
  ["email", /[\w.+-]+@[\w-]+(\.[\w-]+)+/g],
  ["url", /\b(https?:\/\/|www\.)\S+/gi],
  // 台灣的身分證與居留證：英文字母加 9 碼數字。香港身分證：一到兩個英文字母、6 碼數字，括號裡一碼檢查碼
  ["id", /\b[A-Z][12ABCD89]\d{8}\b|\b[A-Z]{1,2}\d{6}\([0-9A]\)/g],
  ["card", /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g],
  // 手機（09 開頭）、市話（0 開頭加區碼）、國際碼，以及香港、澳門的 8 碼
  ["phone", /(\+\d{1,3}[ -]?)?\(?0?\d{1,4}\)?[ -]?\d{3,4}[ -]?\d{3,4}/g],
  // 部分遮住的手機號碼，例如訂單上的「0966***218」，剩下的幾碼加上前後文仍然認得出人
  ["phone", /\b09\d{2}[ -]?(?=[\d -]*\*)[\d*]{3}[ -]?[\d*]{3}(?![\d*])/g],
  ["handle", /(^|[^\w])@[A-Za-z0-9_.]{3,}/g],
  ["number", /\d{8,}/g],
];

// 電話的規則比較寬，要有 8 到 12 個數字，避免把日期、金額框起來，更長的交給「長串數字」。
// 帶國碼（+ 開頭）時放寬到 15 碼，例如 +86 135 1234 5678。部分遮住的號碼不算數字的數量
const digits = (text: string) => text.replace(/\D/g, "").length;
function phoneLike(text: string): boolean {
  if (text.includes("*")) return true;
  const n = digits(text);
  return n >= 8 && n <= (text.trimStart().startsWith("+") ? 15 : 12);
}

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
      if (kind === "phone" && !phoneLike(match)) continue;
      const trimmed = match.trimEnd();
      const end = start + trimmed.length;
      if (taken(start, end)) continue;
      found.push({ kind, start, end, text: trimmed });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// 換行把一段個資拆成兩行時，下一行在上一行的正下方，左邊大致對齊（段首縮排兩三個字也算）
function nextLine(a: Box, b: Box): boolean {
  const h = Math.max(a.h, b.h);
  return b.y > a.y + a.h / 2 && b.y - (a.y + a.h) < h && Math.abs(b.x - a.x) < h * 3;
}

// 個資裡會出現的字：上一行的結尾與下一行的開頭都是這種字，才可能是同一段個資被換行拆開
const CONTINUES = /[\w@.+*-]/;

const boxOf = (boxes: (Box | null)[]) => {
  const real = boxes.filter((b): b is Box => !!b);
  return real.length ? union(real) : null;
};

// 清單裡相鄰的兩項（一行電話、下一行 Email）也是上下兩行、左邊對齊，接起來會把上一行的電話
// 併進 Email。所以上一行的那一半已經是別種個資，或本身就是完整的 Email、網址與帳號時，不接。
// 電話與數字不能用「完整」判斷，02-2963-01 單獨看也像電話。下一行的那一半完整時照樣接，
// 「r119」接「21047@example.edu.tw」的前半段一樣認得出人，多框比漏掉好
const TEXTUAL: PiiKind[] = ["email", "url", "handle"];

// 每一行裡的個資。聊天紀錄的對話框窄，Email 與電話常被換行拆成兩行（press.union@exam、ple.org），
// 一行一行比對的話兩半都對不上，所以相鄰的兩行另外接起來比對，跨過換行的那幾筆在兩行各給一個框。
// 上一行只對到半截的（02-2963-01 接下一行的 88）由接起來的結果取代。
// normalize 在比對前換字，長度不能變，回傳的 text 取自原文
export function findPiiInLineTexts(lines: LineText[], normalize = (text: string) => text): PiiMatch[] {
  const texts = lines.map((line) => normalize(line.text));
  const lineBoxes = lines.map((line) => boxOf(line.boxes));
  const perLine = texts.map((text) => findPiiInText(text));
  // 上一行的那一半（start 到行尾）跟這一行自己比對到的個資衝突
  const conflicts = (line: number, kind: PiiKind, start: number, end: number) =>
    perLine[line]!.some(
      (x) => x.start < end && x.end > start && (x.kind !== kind || (TEXTUAL.includes(kind) && x.start <= start && x.end >= end)),
    );
  const found: { line: number; start: number; end: number; kind: PiiKind; text: string }[] = [];
  const across: typeof found = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = texts[i]!.trimEnd();
    const b = texts[i + 1]!.trimStart();
    const lead = texts[i + 1]!.length - b.length;
    const [boxA, boxB] = [lineBoxes[i], lineBoxes[i + 1]];
    if (!a || !b || !boxA || !boxB || !nextLine(boxA, boxB) || !CONTINUES.test(a.at(-1)!) || !CONTINUES.test(b[0]!)) continue;
    for (const m of findPiiInText(a + b)) {
      if (m.start >= a.length || m.end <= a.length) continue;
      const tail = m.end - a.length;
      if (conflicts(i, m.kind, m.start, a.length)) continue;
      const text = lines[i]!.text.slice(m.start, a.length) + lines[i + 1]!.text.slice(lead, lead + tail);
      across.push({ line: i, start: m.start, end: a.length, kind: m.kind, text });
      across.push({ line: i + 1, start: lead, end: lead + tail, kind: m.kind, text });
    }
  }
  perLine.forEach((matches, i) => {
    for (const m of matches) {
      if (across.some((x) => x.line === i && x.start < m.end && m.start < x.end)) continue;
      found.push({ line: i, start: m.start, end: m.end, kind: m.kind, text: lines[i]!.text.slice(m.start, m.end) });
    }
  });
  return [...found, ...across]
    .sort((x, y) => x.line - y.line || x.start - y.start)
    .flatMap((f) => {
      const box = boxOf(lines[f.line]!.boxes.slice(f.start, f.end));
      return box ? [{ kind: f.kind, text: f.text, box }] : [];
    });
}

// 辨識的結果：字與字之間補一個空白接成一行，字裡的每個位置都用那個字的框
export function findPii(lines: Word[][]): PiiMatch[] {
  return findPiiInLineTexts(
    lines.map((words) => {
      let text = "";
      const boxes: (Box | null)[] = [];
      for (const word of words) {
        if (text) {
          text += " ";
          boxes.push(null);
        }
        text += word.text;
        for (let i = 0; i < word.text.length; i++) boxes.push(word.box);
      }
      return { text, boxes };
    }),
  );
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

import type { Box } from "./index.ts";

// 「框起所有文字」要框哪些範圍。Tesseract 在照片裡會把衣服的紋路、人影與桌面認成
// 「| = ~ aa Bh」這類碎片，只看有沒有字會框出幾十個誤判。實測截圖、文件、名牌與車牌
// 上的真文字，每個字的信心分數幾乎都在 85 以上，照片裡的碎片多在 60 以下，偶爾高分的
// 也只是單獨一個數字或字。所以：
//
// - 可信的字：含有字母、數字或漢字，信心分數 85 以上。4 個字元以上的長字放寬到 75，
//   照片裡的英文名牌常在 80 上下，碎片很少湊得出這麼長的字
// - 一行裡有兩個以上可信的字，或一個 3 個字元以上的可信的字，這一行才算有文字
// - 框的範圍從第一個可信的字到最後一個，再往兩邊延伸到相鄰、60 分以上的字，
//   行首行尾分數稍低的真文字（例如「王」82 分）不會被切掉，前後的碎片不框進來。
// - 同一行裡相鄰的字離得太遠（超過兩個字高）就切成不同段，各自判斷。照片裡同一行
//   遠處的符號常有 80 幾分，不切開的話框會一路拉過去

export interface OcrWord {
  text: string;
  confidence: number; // 0 到 100
  box: Box;
}

const STRONG = 85;
const STRONG_LONG = 75;
const NEIGHBOR = 60;
const MAX_GAP = 2; // 字高的幾倍

const letters = (text: string) => [...text].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;

function trusted(word: OcrWord): boolean {
  const n = letters(word.text);
  return n > 0 && (word.confidence >= STRONG || (word.confidence >= STRONG_LONG && n >= 4));
}

// 同一行裡離得太遠的字分成不同段，各自判斷，遠處的碎片不會把框拉長
function segments(words: OcrWord[]): OcrWord[][] {
  const out: OcrWord[][] = [];
  for (const word of words) {
    const prev = out.at(-1)?.at(-1);
    if (prev && word.box.x - (prev.box.x + prev.box.w) <= MAX_GAP * Math.max(prev.box.h, word.box.h)) out.at(-1)!.push(word);
    else out.push([word]);
  }
  return out;
}

export function textSpans(lines: OcrWord[][]): Box[] {
  const spans: Box[] = [];
  for (const words of lines.flatMap(segments)) {
    const strong = words.flatMap((w, i) => (trusted(w) ? [i] : []));
    if (!strong.length) continue;
    if (strong.length === 1 && letters(words[strong[0]!]!.text) < 3) continue;
    let first = strong[0]!;
    let last = strong.at(-1)!;
    while (first > 0 && words[first - 1]!.confidence >= NEIGHBOR) first--;
    while (last < words.length - 1 && words[last + 1]!.confidence >= NEIGHBOR) last++;
    const span = words.slice(first, last + 1).map((w) => w.box);
    const x = Math.min(...span.map((b) => b.x));
    const y = Math.min(...span.map((b) => b.y));
    spans.push({ x, y, w: Math.max(...span.map((b) => b.x + b.w)) - x, h: Math.max(...span.map((b) => b.y + b.h)) - y });
  }
  return spans;
}

// 密語與密碼產生器的純邏輯，介面在 src/ui/PassphraseTool.tsx。
//
// 隨機來源由呼叫端傳入（瀏覽器裡是 crypto.getRandomValues），測試可以換成固定的
// 序列。這幾支錯了，讀者拿到的是看起來安全的弱密碼，所以每一支都有測試。

export type RandomUint32 = () => number;

export const cryptoRandom: RandomUint32 = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

// 從 [0, limit) 取一個無偏的隨機整數。2^32 不是 limit 的倍數時直接取模會有偏差，
// 把除不盡的尾巴丟掉重抽。
export function randomBelow(limit: number, random: RandomUint32): number {
  const range = 2 ** 32;
  const cutoff = range - (range % limit);
  let value: number;
  do {
    value = random();
  } while (value >= cutoff);
  return value % limit;
}

// 每個字獨立抽取，允許重複。排除重複會讓後面的可選範圍變小，熵比宣稱的低。
export function pickWords(words: readonly string[], count: number, random: RandomUint32): string[] {
  return Array.from({ length: count }, () => words[randomBelow(words.length, random)]!);
}

export function entropyBits(poolSize: number, count: number): number {
  return poolSize < 2 || count < 1 ? 0 : count * Math.log2(poolSize);
}

export const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const;

export type CharsetName = keyof typeof CHARSETS;

// 從勾選的字元集合併後均勻抽取。很多網站要求每一類至少一個，所以抽到缺了某一類
// 就整串重抽：在符合條件的密碼裡仍然是均勻分布，不會偏向特定字元。
export function makePassword(sets: readonly CharsetName[], length: number, random: RandomUint32): string {
  if (!sets.length) throw new Error("no charset");
  const pool = sets.map((s) => CHARSETS[s]).join("");
  const needAll = length >= sets.length;
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += pool[randomBelow(pool.length, random)];
    if (!needAll || sets.every((s) => [...CHARSETS[s]].some((c) => out.includes(c)))) return out;
  }
}

export function passwordPoolSize(sets: readonly CharsetName[]): number {
  return sets.reduce((n, s) => n + CHARSETS[s].length, 0);
}

export function parseWordlist(text: string): string[] {
  return text
    .split("\n")
    .map((w) => w.trim())
    .filter(Boolean);
}

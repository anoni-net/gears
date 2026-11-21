import type { Language } from "./languages.ts";

// 逐字稿的標點建議：Horizon-Labs multilingual-punctuation-truecase-small 在每個詞元後面標出接什麼標點，
// 這裡把標點插進原本的逐字稿，只插入、不改字，讀者確認之後才套用（src/ui/TranscribeEditor.tsx）。
// 評測與做法見社群工作區的 research/gears-punct/01-horizon-punct.md，切段與詞元位置的換算照同目錄的
// browser/bench.js、browser/offsets.mjs。模型在 src/ui/punct.worker.ts 執行，這裡只有文字與數字的處理，
// 不匯入其他模組（Worker 的進入點也匯入這一份），可以在 Node 裡測試。

// 社群重新量化的 8 位元版（只量化權重，Apache-2.0），放在 assets.anoni.net（onion 版由同一個網站的 /models/assets/ 提供），
// 目錄裡有 README.txt、LICENSE 與 NOTICE。每個檔案比對 SHA-256
export const PUNCT_MODEL = {
  repo: "Horizon-Labs/multilingual-punctuation-truecase-small",
  revision: "a527b62e5a3e16de7e316f03234c99422b1c8814",
  source: "https://huggingface.co/Horizon-Labs/multilingual-punctuation-truecase-small",
  license: "Apache-2.0",
  // Transformers.js 的 dtype q8 讀 onnx/model_quantized.onnx
  dtype: "q8",
  dir: "horizon-punct-a527b62",
  files: {
    "config.json": "968fa6c797aa9048264d6be3765d462efa27639df5d6a580aef3e8bb187d60dc",
    "tokenizer.json": "f34b44a6dc8a0eef651bfa10e8325057530152606a69d9c3b6ae02efb1558f0a",
    "tokenizer_config.json": "ea349495764b24570b4560fe2e4a557e5c0a47e6bce782c2409b1d6445cf8633",
    "special_tokens_map.json": "baec30ea10906f16adb8c18af7a34023002c1746542612b8b41c9f09e1351351",
    "onnx/model_quantized.onnx": "835c0d1340f854787a1ac69157d3cb7772a4ef7ba66fadf52c66847a75ad2a8b",
  } as Record<string, string>,
  // 沒有壓縮的大小：模型 141.9 MB，tokenizer 34.4 MB
  bytes: 141938369 + 34363286 + 46440 + 2630 + 636,
  // 經過 Cloudflare 的實際傳輸量（tokenizer 以 br 壓縮成 5.7 MB，2026-11-21 量），畫面上寫的下載量用這個數字
  transfer: 147682261,
} as const;

// 畫面上寫的下載量（MB）
export const PUNCT_MB = Math.round(PUNCT_MODEL.transfer / 1e6);

// 第一版只做華語：評測量過的是 Whisper base、small 與 Breeze-ASR-25 的華語輸出，large-v3-turbo 的華語跟 small
// 是同一種輸出（Whisper 的華語很少帶標點），一起提供。台語（Breeze-ASR-26 把台語轉成華語文字）、粵語（large-v3-turbo
// 輸出書面中文）沒有量過。其他語言的 Whisper 輸出本來就有標點。Omnilingual 的孟加拉語、尼泊爾語、蒙古語評測過可以用，
// 句號要換成 । 這類文字自己的標點，列為之後
const PUNCT_MODELS: readonly string[] = ["small", "base", "turbo", "breeze25"];
export const punctAvailable = (language: Language, model: string) => language === "zh" && PUNCT_MODELS.includes(model);

// 模型的標籤是「標點|大小寫」，只用標點。冒號（F1 只有 0.07）與破折號（中文要寫成雙破折號）當成沒有標點，
// 大小寫一律不用（套上去會改掉華語文字裡的英文）
export type Mark = "." | "," | "?";
export function labelMark(label: string): Mark | null {
  const mark = label.split("|")[0];
  return mark === "." || mark === "," || mark === "?" ? mark : null;
}

// 插入的標點，華語一律用全形
export const FULL_WIDTH: Record<Mark, string> = { ".": "。", ",": "，", "?": "？" };

// 每 400 個詞元一段、重疊 50 個（照 truecase.py），重疊的部分用後一段的結果。
// Transformers.js 的 token-classification pipeline 會截斷在 512 個詞元、也不給字元位置，所以自己切
export const WINDOW = 400;
export const OVERLAP = 50;

// 每一段的範圍 [start, end)，以及這一段的結果留到哪裡（keepTo，後面重疊的部分交給下一段）
export function windows(n: number, size = WINDOW, overlap = OVERLAP): { start: number; end: number; keepTo: number }[] {
  const out = [];
  let start = 0;
  while (start < n) {
    const end = Math.min(n, start + size);
    const keepTo = end === n ? end : end - overlap;
    out.push({ start, end, keepTo });
    if (end === n) break;
    start = keepTo;
  }
  return out;
}

// 逐個字轉小寫，轉換之後長度改變的字（İ 這類）維持原樣，前後的位置才對得起來
export function lowerKeepLen(text: string): string {
  let out = "";
  for (const c of text) {
    const low = c.toLowerCase();
    out += low.length === c.length ? low : c;
  }
  return out;
}

const encoder = new TextEncoder();

// 每個詞元的結尾在 text 裡的 UTF-16 位置。詞元還原成位元組（▁ 換成空白、<0xHH> 是一個位元組），累加之後換成字元位置，
// 再扣掉 Metaspace 在開頭補上的空白。還原出來的字串要等於「空白 + text」，對不上（文字以空白開頭、裡面剛好有 <mask>
// 這類特殊詞元、位元組備援拼不回完整的字）時回傳 null，整次不給建議，位置錯了標點就會插在錯的地方
export function tokenEnds(tokens: readonly string[], text: string): number[] | null {
  const bytes: number[] = [];
  const ends: number[] = [];
  for (const t of tokens) {
    const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(t);
    if (m) bytes.push(parseInt(m[1]!, 16));
    else for (const b of encoder.encode(t.replaceAll("▁", " "))) bytes.push(b);
    ends.push(bytes.length);
  }
  const whole = Uint8Array.from(bytes);
  if (new TextDecoder().decode(whole) !== ` ${text}` || bytes.length !== encoder.encode(` ${text}`).length) return null;
  // 位元組位置 → UTF-16 位置。4 個位元組的字（代理對）占 2 個 UTF-16 單位，落在一個字中間的位置（位元組備援拆開的字）
  // 算到那個字的結尾
  const at = new Int32Array(bytes.length + 1);
  let c = 0;
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    const units = n === 4 ? 2 : 1;
    for (let k = 1; k <= n; k++) at[i + k] = c + units;
    c += units;
    i += n;
  }
  return ends.map((e) => at[e]! - 1);
}

// --- 逐字稿 → 模型的輸入 ---

const ASCII_WORD = /[A-Za-z0-9]/;
// 字母與數字，不含中日韓文字（中日韓文字每個字各自是一個單位，兩個字之間可以放標點）
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}\p{M}]/u.test(c) && !/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u.test(c);
const isPunct = (c: string | undefined) => !!c && /\p{P}/u.test(c);
const isSpace = (c: string | undefined) => !!c && /\s/u.test(c);
// 詞裡面的撇號、連字號（don't、e-mail）與數字裡的 . , :（3.5、1,000、10:30）是文字的一部分，照留
const IN_WORD = new Set([..."'’-&%/@#+"]);
const IN_NUMBER = new Set([...".,:"]);

// 段落接成一段：中文之間不加空白，兩邊都是英數才加一個空白（照個資辨識的 joinLines）。
// starts 是每一段在接起來的字串裡從哪裡開始
export function joinSegments(texts: readonly string[]): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  texts.forEach((t, i) => {
    if (i && ASCII_WORD.test(text.at(-1) ?? "") && ASCII_WORD.test(t[0] ?? "")) text += " ";
    starts.push(text.length);
    text += t;
  });
  return { text, starts };
}

// 交給模型的文字：拿掉原本的標點（評測的輸入沒有標點，模型照這樣訓練）、連續的空白收成一個、開頭與結尾的空白拿掉，
// 再轉小寫。origin[k] 是 clean 的第 k 個 UTF-16 單位在原文的位置
export function cleanForModel(text: string): { clean: string; origin: number[] } {
  let clean = "";
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (isSpace(c)) {
      if (clean && !clean.endsWith(" ")) {
        clean += " ";
        origin.push(i);
      }
      continue;
    }
    if (isPunct(c)) {
      const keep = (IN_WORD.has(c) && isWord(text[i - 1]) && isWord(text[i + 1])) || (IN_NUMBER.has(c) && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""));
      if (!keep) continue;
    }
    clean += c;
    origin.push(i);
  }
  while (clean.endsWith(" ")) {
    clean = clean.slice(0, -1);
    origin.pop();
  }
  return { clean: lowerKeepLen(clean), origin };
}

// 模型的結果：交給模型的文字裡，第幾個 UTF-16 位置之後接什麼標點
export type Prediction = [at: number, mark: Mark];

export interface Insert {
  at: number; // 段落文字裡的 UTF-16 位置，標點插在這個位置之前的字後面
  mark: string; // 全形的標點
}

// 模型的結果分回各段。只在可以斷開的地方插入：詞的中間（英文字母、數字之間）不插，前一個字或下一個字
// （略過空白）已經是標點時不插，Whisper 原本的標點保留。落在段落結尾的標點屬於那一段
export function placeMarks(texts: readonly string[], predictions: readonly Prediction[]): Insert[][] {
  const { text, starts } = joinSegments(texts);
  const { origin } = cleanForModel(text);
  const out: Insert[][] = texts.map(() => []);
  const used = new Set<number>();
  for (const [at, mark] of predictions) {
    if (at <= 0 || at > origin.length) continue;
    // 接在 clean 第 at-1 個字後面，對到原文那個字的結尾。落在空白上時退回前一個字
    let k = at - 1;
    while (k >= 0 && isSpace(text[origin[k]!])) k--;
    if (k < 0) continue;
    let p = origin[k]! + 1;
    // 代理對的後半
    if (/[\uDC00-\uDFFF]/.test(text[p] ?? "") && /[\uD800-\uDBFF]/.test(text[p - 1] ?? "")) p++;
    const before = text[p - 1];
    let n = p;
    while (isSpace(text[n])) n++;
    const after = text[n];
    if (isPunct(before) || isPunct(after)) continue;
    if (isWord(before) && isWord(text[p])) continue;
    if (used.has(p)) continue;
    used.add(p);
    // 屬於哪一段：p 落在某一段的結尾時算那一段，不算下一段的開頭
    let seg = starts.length - 1;
    while (seg > 0 && p <= starts[seg]!) seg--;
    const local = p - starts[seg]!;
    if (local < 0 || local > texts[seg]!.length) continue;
    out[seg]!.push({ at: local, mark: FULL_WIDTH[mark] });
  }
  for (const list of out) list.sort((a, b) => a.at - b.at);
  return out;
}

// 把標點插進段落，原本的字一個都不動
export function applyInserts(text: string, inserts: readonly Insert[]): string {
  let out = "";
  let prev = 0;
  for (const { at, mark } of [...inserts].sort((a, b) => a.at - b.at)) {
    out += text.slice(prev, at) + mark;
    prev = at;
  }
  return out + text.slice(prev);
}

// 顯示用：段落切成一般的文字與建議的標點，依序排好
export function splitForDisplay(text: string, inserts: readonly Insert[]): { text: string; suggested: boolean }[] {
  const parts: { text: string; suggested: boolean }[] = [];
  let prev = 0;
  for (const { at, mark } of [...inserts].sort((a, b) => a.at - b.at)) {
    if (at > prev) parts.push({ text: text.slice(prev, at), suggested: false });
    parts.push({ text: mark, suggested: true });
    prev = at;
  }
  if (prev < text.length) parts.push({ text: text.slice(prev), suggested: false });
  return parts;
}

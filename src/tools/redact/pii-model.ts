import type { Box } from "./index.ts";
import { type LineText, boxOf } from "./pii.ts";

// 個資辨識模型（#139、#187）：找人名、地址與單位。遮蔽、檢查畫面內容、寫作習慣檢查與逐字稿共用，
// 裝置量測（src/ui/PiiBench.tsx）也用這一份。Transformers.js 4.3 的 token-classification 不回傳字元位置，
// 詞元對回原文的做法照社群工作區研究的 eval/pii-model.mjs：自己逐一解碼詞元、對回原文，
// 再把相鄰、同一類的詞元合成一個範圍。不碰 DOM，有單元測試。

// nym-pii 的 q4 版（MIT），onnx-community 轉好的 Transformers.js 用的 ONNX 檔，照原樣放在 assets.anoni.net
// （目錄裡有 README.txt 與授權全文，onion 版由同一個網站的 /models/assets/ 提供）。Hugging Face 送的是原始大小，
// 從自己的網域經過 Cloudflare 時 tokenizer 會壓縮，實際傳輸約 200 MB（#187）。每個檔案比對 SHA-256
export const PII_MODEL = {
  repo: "onnx-community/nym-pii-multilingual-ONNX",
  revision: "7ce7f1a4dfc55a8037c3ae539b538fee2d44e5f0",
  source: "https://huggingface.co/Wismut/nym-pii-multilingual",
  license: "MIT",
  name: "nym-pii",
  dtype: "q4",
  dir: "nym-pii-7ce7f1a",
  files: {
    "config.json": "44d8be23e7152dffc1bbe77a639b7ed4631592cafe29a443d1704bbe8cdd4bd3",
    "tokenizer.json": "e977adcc6faffc532cb774decca6a9e4f44ad6075930d625dee7cb1ac3aa6121",
    "tokenizer_config.json": "14b147f2a4f939d9b12ab36e9633917040dd948fa78ce283b03402e4cf2c9cba",
    "onnx/model_q4.onnx": "6302a673dcf5a4782abc8e7a339bacb1215e5b7b2cf280f749d1d82b3598a9ec",
    "onnx/model_q4.onnx_data": "e98dc55d9f40d0a53e35b6ff05481af509bdf3c0961671116dd032252349ac07",
  } as Record<string, string>,
  // 沒有壓縮的大小：模型 0.7 MB 加外部權重 194.6 MB，tokenizer 15.4 MB
  bytes: 701534 + 194565120 + 15395262 + 5984 + 574,
} as const;

// 模型的標籤對應到人看得懂的幾類。日期、時間、年齡、職稱這類不算個資，對不到的不列
export type PiiModelKind = "person" | "address" | "org" | "phone" | "email" | "id" | "other";
const LABELS: Record<string, PiiModelKind> = {
  GIVEN_NAME: "person",
  SURNAME: "person",
  STREET_ADDRESS: "address",
  STREET_NAME: "address",
  BUILDING_NUMBER: "address",
  SECONDARY_ADDRESS: "address",
  ZIP_CODE: "address",
  CITY: "address",
  STATE: "address",
  COMPANY_NAME: "org",
  PHONE: "phone",
  FAX_NUMBER: "phone",
  EMAIL: "email",
  GOVERNMENT_ID: "id",
  SSN: "id",
  PASSPORT: "id",
  DRIVERS_LICENSE: "id",
  TAX_ID: "id",
  ACCOUNT_NUMBER: "other",
  CREDIT_DEBIT_CARD: "other",
  IBAN: "other",
  CUSTOMER_ID: "other",
  EMPLOYEE_ID: "other",
  MEDICAL_RECORD_NUMBER: "other",
  LICENSE_PLATE: "other",
  USERNAME: "other",
  DATE_OF_BIRTH: "other",
  URL: "other",
  ROUTING_NUMBER: "other",
  SWIFT_BIC: "other",
  MAC_ADDRESS: "other",
  API_KEY: "other",
  PASSWORD: "other",
  PIN: "other",
  CVV: "other",
};

export const labelKind = (label: string): PiiModelKind | null => LABELS[label.replace(/^[BIES]-/, "")] ?? null;

export interface PiiSpan {
  kind: PiiModelKind;
  start: number;
  end: number;
}

// 原文逐字做 NFKC 與小寫，記下每個字在原文的位置。tokenizer 會把「：」正規化成「:」
export function normalize(text: string): { norm: string; origin: [number, number][] } {
  let norm = "";
  const origin: [number, number][] = [];
  for (let i = 0; i < text.length; ) {
    const len = text.codePointAt(i)! > 0xffff ? 2 : 1;
    const n = text.slice(i, i + len).normalize("NFKC").toLowerCase();
    for (let k = 0; k < n.length; k++) origin.push([i, i + len]);
    norm += n;
    i += len;
  }
  origin.push([text.length, text.length]);
  return { norm, origin };
}

export interface Decoder {
  decode(ids: number[], options: { skip_special_tokens: boolean }): string;
  all_special_ids?: number[];
  unk_token_id?: number;
}

// 每個詞元在原文的範圍。逐一解碼詞元，從上一個詞元的結尾往後找。解碼出半個字（byte fallback）的詞元
// 跟後面的合在一起，[UNK] 這類找不到的，取前後兩個詞元之間的空隙
export function align(tokenizer: Decoder, text: string, ids: number[]): ([number, number] | null)[] {
  const { norm, origin } = normalize(text);
  const special = new Set(tokenizer.all_special_ids ?? []);
  const unk = tokenizer.unk_token_id;
  const spans: ([number, number] | "gap" | null)[] = new Array(ids.length).fill(null);
  let cursor = 0;
  for (let j = 0; j < ids.length; j++) {
    if (special.has(ids[j]!) && ids[j] !== unk) continue;
    if (ids[j] === unk) {
      spans[j] = "gap";
      continue;
    }
    let k = j;
    let piece = tokenizer.decode([ids[j]!], { skip_special_tokens: true });
    while (piece.includes("�") && k + 1 < ids.length) {
      k++;
      piece = tokenizer.decode(ids.slice(j, k + 1), { skip_special_tokens: true });
    }
    piece = piece.replace(/^##/, "").normalize("NFKC").toLowerCase().trim();
    if (!piece || piece.includes("�")) {
      j = k;
      continue;
    }
    const at = norm.indexOf(piece, cursor);
    if (at < 0 || at - cursor > 20) {
      for (let m = j; m <= k; m++) spans[m] = "gap";
      j = k;
      continue;
    }
    const span: [number, number] = [origin[at]![0], origin[at + piece.length - 1]![1]];
    for (let m = j; m <= k; m++) spans[m] = span;
    cursor = at + piece.length;
    j = k;
  }
  return spans.map((s, j) => {
    if (s !== "gap") return s;
    const prev = spans.slice(0, j).reverse().find((x): x is [number, number] => Array.isArray(x));
    const next = spans.slice(j + 1).find((x): x is [number, number] => Array.isArray(x));
    let start = prev ? prev[1] : 0;
    let end = next ? next[0] : text.length;
    while (start < end && /\s/.test(text[start]!)) start++;
    while (end > start && /\s/.test(text[end - 1]!)) end--;
    return end > start ? [start, end] : null;
  });
}

// 每個詞元分數最高的標籤，相鄰（中間只有空白）而且同一類的合成一個範圍
export function groupSpans(text: string, items: { kind: PiiModelKind; start: number; end: number }[]): PiiSpan[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: PiiSpan[] = [];
  for (const it of sorted) {
    const last = out.at(-1);
    // 同一個字被切成好幾個詞元時範圍會重疊，中間只有空白的也合在一起
    if (last && last.kind === it.kind && (it.start <= last.end || /^\s*$/.test(text.slice(last.end, it.start)))) last.end = Math.max(last.end, it.end);
    else out.push({ ...it });
  }
  return out;
}

export function argmax(row: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < row.length; i++) if (row[i]! > row[best]!) best = i;
  return best;
}

// --- 文字行與字框 ---

// 文字辨識或 PDF 文字層的每一行接成一段交給模型，行與行之間放換行。模型讀到完整的句子，
// 被換行拆開的人名與地址也找得到（社群工作區 research/gears-ocr 的 pipeline.mjs）。
// at 是每個位置來自哪一行的第幾個字，換行是 null
export function joinLines(lines: LineText[]): { text: string; at: ([number, number] | null)[] } {
  let text = "";
  const at: ([number, number] | null)[] = [];
  lines.forEach((line, i) => {
    if (i) {
      text += "\n";
      at.push(null);
    }
    text += line.text;
    for (let k = 0; k < line.text.length; k++) at.push([i, k]);
  });
  return { text, at };
}

export interface ModelMatch {
  kind: PiiModelKind;
  text: string;
  box: Box;
}

// 模型找到的範圍換回字框：跨行的範圍每一行各給一個框，text 是那一行裡的字。
// 只有空白或補上的位置（沒有字框）的那一段不給框
export function spanBoxes(lines: LineText[], at: ([number, number] | null)[], spans: PiiSpan[]): ModelMatch[] {
  const out: ModelMatch[] = [];
  for (const span of spans) {
    const pieces = new Map<number, [number, number]>();
    for (let i = span.start; i < span.end; i++) {
      const pos = at[i];
      if (!pos) continue;
      const [line, k] = pos;
      const piece = pieces.get(line);
      pieces.set(line, piece ? [piece[0], k + 1] : [k, k + 1]);
    }
    for (const [line, [start, end]] of pieces) {
      const text = lines[line]!.text.slice(start, end);
      const box = text.trim() ? boxOf(lines[line]!.boxes.slice(start, end)) : null;
      if (box) out.push({ kind: span.kind, text, box });
    }
  }
  return out;
}

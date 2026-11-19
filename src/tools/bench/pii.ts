// 裝置量測的個資辨識（src/ui/PiiBench.tsx）：遮蔽與寫作習慣檢查之後可能用的個資辨識模型
// （#139，社群工作區的 research/gears-pii/）在這台裝置上要多久、記憶體夠不夠。
// 詞元對回原文的做法照研究的 eval/pii-model.mjs：Transformers.js 4.3 的 token-classification
// 不回傳字元位置，自己逐一解碼詞元、對回原文，再把相鄰、同一類的詞元合成一個範圍。

// nym-pii 的 q4 版（MIT），鎖定 commit。onnx-community 已經轉好 Transformers.js 用的 ONNX 檔
export const PII_MODEL = {
  repo: "onnx-community/nym-pii-multilingual-ONNX",
  revision: "7ce7f1a4dfc55a8037c3ae539b538fee2d44e5f0",
  source: "https://huggingface.co/Wismut/nym-pii-multilingual",
  license: "MIT",
  name: "nym-pii",
  dtype: "q4",
  // Hugging Face 上的檔案大小（2026-11-19 查的 tree API）：模型 0.7 MB 加外部權重 194.6 MB，tokenizer 15.4 MB
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

export interface PiiSpan {
  kind: PiiModelKind;
  start: number;
  end: number;
}

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

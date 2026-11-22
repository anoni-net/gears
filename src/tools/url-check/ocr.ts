import type { Box } from "../redact/index.ts";
import { type LineText, boxOf } from "../redact/pii.ts";
import { isShortener, parseUrl } from "./clean.ts";

// 從截圖的文字辨識結果讀出網址（網址檢查的「從截圖讀出網址」與檔案畫面的「畫面上的網址」）。
//
// 只做格式上的整理：全形字元換成半形、夾在英數之間的句號與間隔點換成點、網址裡多出來的空白拿掉、
// 網址被換行切開時接回來、結尾的標點拿掉。看起來像 l 與 1、O 與 0 的字一律照辨識的結果，不自動修正：
// 網址檢查要抓的就是 paypa1、rnicrosoft 這類仿冒的網域，自動修正會把詐騙網址改成正牌的。
// 讀者對照截圖上的裁切小圖確認。規則依社群工作區的評測調整（research/gears-ocr/03-url-ocr.md）。
//
// 輸入是辨識出的每一行（src/tools/redact/ppocr.ts 的 ocrLineText：照辨識的原文，每個位置一個字框，
// 空白是 null），輸出的網址保留在截圖上的範圍，跨行時合併成一個框，裁切小圖用這個範圍。

export interface OcrUrl {
  text: string; // 整理之後的網址，照截圖上的寫法，沒有 https:// 的不補
  box: Box; // 截圖上的範圍，跨行時是幾行合起來的框
  lines: number; // 跨了幾行
}

interface Ch {
  c: string;
  box: Box | null;
}

const ALNUM = /^[A-Za-z0-9]$/;
// 網址裡會出現的字（RFC 3986 的保留字與非保留字，加上 %）
const URL_CHAR = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]$/;
// 結尾的這些字多半是句子的標點，不算進網址
const TRAILING = /[.,;:!?'")\]}>]+$/;
// 上一段停在這些字時網址一定還沒完，下一行從這些字開始時也一定是接著的
const CONTINUES = /[/.\-_=&?#%~+:@]$/;
const LEADS = /^[/.\-_=&?#%~+]/;
// 中文輸入法打出的句號與辨識時常把點認成的字（間隔點、度數符號），夾在英數之間時換成點。
// 中文的句號「。」常被認成 º、°，前後還多出空白（example º com ° tw）
const DOTS = /^[。｡·•∙・‧º°]$/;

// 全形的英數與符號（U+FF01 到 U+FF5E）換成半形，全形空白換成半形空白
function halfWidth(c: string): string {
  const cp = c.codePointAt(0)!;
  if (cp >= 0xff01 && cp <= 0xff5e) return String.fromCodePoint(cp - 0xfee0);
  if (cp === 0x3000) return " ";
  return c;
}

function chars(line: LineText): Ch[] {
  let out: Ch[] = [];
  for (let i = 0; i < line.text.length; ) {
    const c = String.fromCodePoint(line.text.codePointAt(i)!);
    out.push({ c: halfWidth(c), box: line.boxes[i] ?? null });
    i += c.length;
  }
  // 點的替代字：前後（略過一個空白）都是英數時換成點，夾著的空白拿掉。在網址後面收尾的句號不換，
  // 免得把下一句接成網域
  const drop = new Set<number>();
  out.forEach((ch, i) => {
    if (!DOTS.test(ch.c)) return;
    const before = out[i - 1]?.c === " " ? i - 2 : i - 1;
    const after = out[i + 1]?.c === " " ? i + 2 : i + 1;
    if (!ALNUM.test(out[before]?.c ?? "") || !ALNUM.test(out[after]?.c ?? "")) return;
    ch.c = ".";
    for (let k = before + 1; k < after; k++) if (k !== i) drop.add(k);
  });
  // 協定後面多出來的空白：「https ://」、「https: //」
  const text = out.map((ch) => ch.c).join("");
  for (const m of text.matchAll(/https?( *):( *)\/( *)\//gi)) {
    for (let k = m.index; k < m.index + m[0].length; k++) if (out[k]!.c === " ") drop.add(k);
  }
  // 「？」、「＝」這類全形符號左右較寬，辨識時常在前面多一個空白（item ?id=5）。前面是網址的字時拿掉
  out.forEach((ch, i) => {
    if (ch.c === " " && /^[?=&#]$/.test(out[i + 1]?.c ?? "") && /^[A-Za-z0-9/_-]$/.test(out[i - 1]?.c ?? "") && URL_CHAR.test(out[i + 2]?.c ?? "")) drop.add(i);
  });
  if (drop.size) out = out.filter((_, i) => !drop.has(i));
  return out;
}

const textOf = (cs: Ch[]) => cs.map((ch) => ch.c).join("");
const blank = (cs: Ch[]) => cs.every((ch) => ch.c === " ");

// 一段連續的網址字元，從 start 開始
function runFrom(cs: Ch[], start: number): number {
  let end = start;
  while (end < cs.length && URL_CHAR.test(cs[end]!.c)) end++;
  return end;
}

// 結尾的標點拿掉，回傳留下的長度。括號成對時保留（維基百科的網址常帶括號）
function trimEnd(text: string): number {
  let end = text.length;
  for (;;) {
    const body = text.slice(0, end);
    const m = TRAILING.exec(body);
    if (!m) return end;
    let cut = m.index;
    const head = body.slice(0, cut);
    if (body[cut] === ")" && (head.match(/\(/g)?.length ?? 0) > (head.match(/\)/g)?.length ?? 0)) cut++;
    if (cut === end) return end;
    end = cut;
  }
}

// 這一段文字是不是網址：有 http(s):// 或 www. 開頭的直接算；沒有的要像網域（至少兩段、最後一段是
// 兩個字以上的英文字母），或是認得的短網址服務（bit.ly、lin.ee 這類，clean.ts 的 isShortener）。
// 判斷方式跟網址檢查相同（parseUrl）。Email 不算
export function looksLikeUrl(text: string): boolean {
  if (/^https?:\/\/\S/i.test(text)) return typeof parseUrl(text) !== "string";
  if (text.includes("@") && !/[/?#]/.test(text.split("@")[0]!)) return false;
  const url = parseUrl(text);
  if (typeof url === "string") return false;
  const host = url.hostname;
  if (/^www\./i.test(text) || isShortener(host)) return true;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !l)) return false;
  // 句點後面少了空白的句子（locked.Verify）：網域的最後一段不會寫成首字大寫
  if (/^[A-Z][a-z]+$/.test(text.split(/[/?#:]/)[0]!.split(".").at(-1)!)) return false;
  return /^[a-z]{2,}$/.test(labels.at(-1)!) || /^xn--[a-z0-9-]+$/.test(labels.at(-1)!);
}

// 行尾這一段可能是網址的開頭：有協定、www.、點，或是協定的前半（ht、https:），或是網域的一段、
// 帶著連字號或跟下一行之間是點、連字號（1ine- 接 pay.test、netflix-b 接 illing.example、g00gle 接 -verify.example）。
// 緊接在中文後面、沒有空白的英數也算（「驗證：ex」接 ample.com.tw、「至paypa」接 l-secure.example），
// 中文句子裡的網址前後常不空格。英文句子行尾的單字（Ver 接 ify at）前面有空白，不接下一行
function mayStart(text: string, piece: string, glued: boolean): boolean {
  if (glued || /:\/\/|^www\.|\./i.test(text) || /^(ht|htt|https?:?\/?)$/i.test(text)) return true;
  return /^[a-z0-9-]+$/i.test(text) && (text.includes("-") || /^[.-]/.test(piece));
}

// 下一行是不是接著的：上一段停在斜線、點、連字號這類網址不會停下的字，或下一行從這類字開始，就接。
// 兩邊都是英數、網址本身已經完整，下一行又是兩個字母以上的英文單字時，分不出是被切開的網址
// （getting-sta 接 rted）還是句子的下一個字（now.）或下一行的訊息（OK）：
// - 單字後面接著標點或別的字：句子的下一個字，不接
// - 首字大寫或全部大寫（OK、Thanks）：另一句話的開頭，不接
// - 只有一個小寫的單字：上一行寫滿了才接。被切開的網址會把那一行排滿，寫滿看的是同一側對齊的行裡最寬的那幾行
// 一個字母加句號照樣接（網址最後一個字母被擠到下一行，後面是被認成點的「。」）
function joins(text: string, piece: string, more: boolean, full: boolean): boolean {
  if (CONTINUES.test(text) || LEADS.test(piece)) return true;
  if (!looksLikeUrl(text.slice(0, trimEnd(text)))) return true;
  if (!/^[A-Za-z]{2,}[.,!]?$/.test(piece)) return true;
  // 首字大寫或全部大寫的單字（OK、Thanks）是另一句話的開頭
  if (/^[A-Z]/.test(piece) && !/[a-z][A-Z]/.test(piece)) return false;
  return !/[.,!]$/.test(piece) && !more && full;
}

// 同一個視覺上的行：偵測有時把一行切成好幾塊（中文與網址之間有空隙），往左右找緊鄰的塊，
// 取整行的左右邊界
function rowSpan(boxes: (Box | null)[], i: number): [number, number] {
  const a = boxes[i]!;
  let [left, right] = [a.x, a.x + a.w];
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of boxes) {
      if (!b) continue;
      const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      // 對話框旁邊的時間字比較小，不算同一行
      if (overlap <= 0.5 * Math.min(a.h, b.h) || b.h < 0.75 * a.h || b.h > a.h / 0.75) continue;
      if (b.x < left && left - (b.x + b.w) < 1.5 * a.h) [left, changed] = [b.x, true];
      if (b.x + b.w > right && b.x - right < 1.5 * a.h) [right, changed] = [b.x + b.w, true];
    }
  }
  return [left, right];
}
const rowLeft = (boxes: (Box | null)[], i: number) => rowSpan(boxes, i)[0];

// 同一個視覺上的行，右邊緊鄰的那一塊從英數開始（英文句子的下一個字被偵測切成另一塊）
function wordAfter(all: Ch[][], boxes: (Box | null)[], j: number): boolean {
  const a = boxes[j]!;
  return boxes.some((b, k) => {
    if (!b || k === j || b.x < a.x + a.w) return false;
    const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return overlap > 0.5 * Math.min(a.h, b.h) && b.h > 0.75 * a.h && b.x - (a.x + a.w) < 1.5 * a.h && ALNUM.test(all[k]!.find((ch) => ch.c !== " ")?.c ?? "");
  });
}

// 這一行寫滿了沒有：跟左邊或右邊對齊的行（同一側的對話框、同一段文字）裡，最寬的那幾行之一
function filled(boxes: (Box | null)[], i: number): boolean {
  const h = boxes[i]!.h;
  const [left, right] = rowSpan(boxes, i);
  let widest = 0;
  boxes.forEach((b, k) => {
    if (!b) return;
    const [l, r] = rowSpan(boxes, k);
    if (Math.abs(l - left) < h || Math.abs(r - right) < h) widest = Math.max(widest, r - l);
  });
  return right - left >= widest - 1.5 * h;
}

// 下一行在上一行的正下方，行距跟同一段文字相同（聊天的對話框之間、段落之間的空隙比行距大，
// 評測裡同一個對話框的行距在字高的四成以內，相鄰對話框之間在六成以上），
// 字的高度相近（底線、雜點認成的短行不算，小寫字母的行比較矮），左邊對齊同一個視覺上的行
function below(a: Box, b: Box, left: number): boolean {
  const gap = b.y - (a.y + a.h);
  return b.y > a.y + a.h / 2 && gap < a.h * 0.6 && b.h > a.h * 0.5 && b.h < a.h * 1.6 && Math.abs(b.x - left) < a.h * 1.5;
}

// 同一欄的下一行：辨識結果由上而下、由左而右排，對話框旁邊的時間、另一欄的行可能夾在中間，
// 取左邊最對齊、字的高度最接近的那一行
function nextLine(boxes: (Box | null)[], i: number): number | null {
  const a = boxes[i];
  if (!a) return null;
  const left = rowLeft(boxes, i);
  const off = (b: Box) => Math.abs(b.x - left) + Math.abs(b.h - a.h);
  let best: number | null = null;
  for (let j = i + 1; j < Math.min(boxes.length, i + 6); j++) {
    const b = boxes[j];
    if (b && below(a, b, left) && (best === null || off(b) < off(boxes[best]!))) best = j;
  }
  return best;
}

export function urlsFromLines(lines: LineText[]): OcrUrl[] {
  const all = lines.map(chars);
  const lineBox = all.map((cs) => boxOf(cs.map((ch) => ch.box)));
  const consumed = all.map(() => 0); // 每一行開頭被接到上一行的長度
  const found: OcrUrl[] = [];
  for (const [li, cs] of all.entries()) {
    for (let i = consumed[li]!; i < cs.length; ) {
      if (!URL_CHAR.test(cs[i]!.c)) {
        i++;
        continue;
      }
      const runEnd = runFrom(cs, i);
      // 網址從英數開始。一段裡從 http 或 www. 開始的位置之前的字（中文標點換成的冒號、括號）不算
      let start = i;
      // 前面緊接著中文（不是空白、也不在行首）
      const glued = i > 0 && cs[i - 1]!.c !== " " && cs[i - 1]!.c.codePointAt(0)! > 0x7f;
      const scheme = textOf(cs.slice(i, runEnd)).search(/https?:\/\/|www\./i);
      if (scheme > 0) start += scheme;
      while (start < runEnd && !ALNUM.test(cs[start]!.c)) start++;
      i = runEnd;
      if (start === runEnd) continue;
      let text = textOf(cs.slice(start, runEnd));
      const boxes = cs.slice(start, runEnd).map((ch) => ch.box);
      const taken: [number, number][] = [];
      let [cur, curEnd] = [li, runEnd];
      // 網址在這一行的最後（後面只剩空白）時，看下一行是不是接著的
      while (blank(all[cur]!.slice(curEnd))) {
        const next = nextLine(lineBox, cur);
        if (next === null) break;
        const ncs = all[next]!;
        const lead = consumed[next]! || ncs.findIndex((ch) => ch.c !== " ");
        if (lead < 0) break;
        const end = runFrom(ncs, lead);
        const piece = textOf(ncs.slice(lead, end));
        // 這一段後面還有別的字：同一塊裡空一格接著字，或同一個視覺上的行右邊還有別的塊（單字之間的空隙大時偵測會切開）
        const more = (end < ncs.length && ncs[end]!.c === " " && !blank(ncs.slice(end))) || (blank(ncs.slice(end)) && wordAfter(all, lineBox, next));
        if (!piece || /^(https?:|www\.)/i.test(piece) || !mayStart(text, piece, glued) || !joins(text, piece, more, filled(lineBox, cur))) break;
        text += piece;
        boxes.push(...ncs.slice(lead, end).map((ch) => ch.box));
        taken.push([next, end]);
        [cur, curEnd] = [next, end];
      }
      const cut = trimEnd(text);
      text = text.slice(0, cut);
      const box = boxOf(boxes.slice(0, cut));
      if (!box || !looksLikeUrl(text)) continue;
      // 接起來的那幾行，開頭那一段不再當成另一個網址
      for (const [line, end] of taken) consumed[line] = end;
      if (found.some((f) => f.text === text)) continue;
      found.push({ text, box, lines: 1 + taken.length });
    }
  }
  return found;
}

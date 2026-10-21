import type { Box } from "./index.ts";
import { type PiiMatch, findPiiInLineTexts } from "./pii.ts";

// PDF 遮蔽的自動尋找改讀 PDF 本身的文字層，不必先畫成圖片再辨識（src/ui/redact-detect.ts 的
// findPdfText）。pdf.js 的 getTextContent() 給出一段一段的文字與位置，這裡排成一行一行、估出每個字
// 的範圍，再用跟辨識結果同一套規則（pii.ts 的 findPiiInLineTexts）找個資。
//
// 位置的算法照 pdf.js 自己的文字層（TextLayer 的 #appendText）：段落的原點在基線上，沿著
// 書寫方向的角度展開，往上是字高乘上 ascent。座標已經換算到畫布，跟遮蔽框是同一套。
// 直書不照 pdf.js：直書的字形以原點為中心左右各占半個字寬（PDF 規格的 position vector），
// pdf.js 的文字層沿用橫書的 ascent，整欄會偏向一邊，用 MSung-Light 的直書 PDF 實測過
//
// pdf.js 只給整段的寬度，每個字的位置依字寬的比例分配：全形字（漢字、假名、諺文、全形符號）
// 算 1，其他算 0.55，空白算 0.3。比例字型的英文會有誤差，所以每個字的範圍沿著書寫方向
// 兩邊各多留四分之一個字高，框起來的個資還會再往外多留一些（pii.ts 的 pad）。

// 一段文字。transform 是 pdf.js 的 viewport.transform 乘上這一段的 transform
export interface TextRun {
  str: string;
  transform: number[];
  length: number; // 沿著書寫方向的長度，畫布的像素
  ascent: number; // 字高裡基線以上的比例
  vertical: boolean;
  eol: boolean; // pdf.js 判斷這一段之後換行
}

export interface TextLine {
  text: string;
  // text 每個位置（UTF-16）的字的範圍，補上的空白是 null
  boxes: (Box | null)[];
}

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3fffd}]/u;
const weight = (char: string) => (/\s/.test(char) ? 0.3 : WIDE.test(char) ? 1 : 0.55);

interface Geometry {
  angle: number;
  height: number;
  top: number; // 字的上緣，在書寫方向的垂直方向上，相對基線
  point(x: number, y: number): [number, number];
}

function geometry(run: TextRun): Geometry {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = run.transform;
  // 直書的段落在 pdf.js 的文字層裡轉 90 度
  const angle = Math.atan2(b, a) + (run.vertical ? Math.PI / 2 : 0);
  const height = Math.hypot(c, d);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const top = run.vertical ? -height / 2 : -run.ascent * height;
  return { angle, height, top, point: (x, y) => [e + x * cos - y * sin, f + x * sin + y * cos] };
}

// 書寫方向上 x0 到 x1、一個字高的範圍，轉成畫布上的外框
function rect(g: Geometry, x0: number, x1: number): Box {
  const corners = [g.point(x0, g.top), g.point(x1, g.top), g.point(x0, g.top + g.height), g.point(x1, g.top + g.height)];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// 把一段文字切成每個字的範圍，surrogate pair 的兩個位置用同一個框
function glyphs(run: TextRun, g: Geometry): Box[] {
  const chars = Array.from(run.str);
  const total = chars.reduce((n, c) => n + weight(c), 0) || 1;
  const margin = g.height / 4;
  const out: Box[] = [];
  let at = 0;
  for (const char of chars) {
    const w = (weight(char) / total) * run.length;
    const box = rect(g, at - margin, at + w + margin);
    for (let i = 0; i < char.length; i++) out.push(box);
    at += w;
  }
  return out;
}

// 依 pdf.js 的換行、基線與方向把文字段落排成一行一行。同一行裡兩段之間的距離超過三成字高、
// 兩邊又都不是空白時補一個空白，電話被拆成兩段時不會接成一串長數字，也不會被空白切斷
export function textLines(runs: TextRun[]): TextLine[] {
  const lines: TextLine[] = [];
  let line: TextLine | null = null;
  let last: { g: Geometry; end: [number, number]; origin: [number, number] } | null = null;
  const close = () => {
    if (line?.text.trim()) lines.push(line);
    line = null;
    last = null;
  };
  for (const run of runs) {
    if (run.str) {
      const g = geometry(run);
      const origin = g.point(0, 0);
      if (line && last) {
        const prev: { g: Geometry; end: [number, number]; origin: [number, number] } = last;
        const cos = Math.cos(prev.g.angle);
        const sin = Math.sin(prev.g.angle);
        // 跟上一段的基線差多少（垂直方向）、往前接了多遠（書寫方向）
        const across = Math.abs(-(origin[0] - prev.origin[0]) * sin + (origin[1] - prev.origin[1]) * cos);
        const gap = (origin[0] - prev.end[0]) * cos + (origin[1] - prev.end[1]) * sin;
        const size = Math.max(prev.g.height, g.height);
        const turned = Math.abs(g.angle - prev.g.angle) > 0.05;
        if (turned || across > size / 2 || gap < -size / 2) close();
        else if (gap > size * 0.3 && !/\s$/.test(line.text) && !/^\s/.test(run.str)) {
          line.text += " ";
          line.boxes.push(null);
        }
      }
      line ??= { text: "", boxes: [] };
      line.text += run.str;
      line.boxes.push(...glyphs(run, g));
      last = { g, origin, end: g.point(run.length, 0) };
    }
    if (run.eol) close();
  }
  close();
  return lines;
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

// 限制在頁面裡，整個在頁面外的不算
function clip(box: Box, width: number, height: number): Box | null {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const w = Math.min(width, box.x + box.w) - x;
  const h = Math.min(height, box.y + box.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// 全形的英數與符號換成半形，全形空白換成半形空白。每個字仍是一個 UTF-16 的位置，比對到的
// 位置跟原文對得上。公文與直書常把電話寫成「０９１２－３４５－６７８」。寫作習慣檢查把全形
// 英數當成要修正的習慣，所以只在這裡換，不改 findPiiInText
const halfwidth = (text: string) => text.replace(/[\uff01-\uff5e\u3000]/g, (c) => (c === "\u3000" ? " " : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));

// 每一行裡的個資，比對到的字合成一個框。段落換行把 Email 拆成兩行時，上下兩行接起來比對
export function findPiiInLines(lines: TextLine[], width: number, height: number): PiiMatch[] {
  return findPiiInLineTexts(lines, halfwidth).flatMap((m) => {
    const box = clip(m.box, width, height);
    return box ? [{ ...m, box }] : [];
  });
}

// 「框起所有文字」：每一行有字母、數字或漢字的範圍
export function lineBoxes(lines: TextLine[], width: number, height: number): Box[] {
  return lines.flatMap((line) => {
    if (!/[\p{L}\p{N}]/u.test(line.text)) return [];
    const box = clip(union(line.boxes.filter((b): b is Box => !!b)), width, height);
    return box ? [box] : [];
  });
}

// 私用區與替代字元：PDF 缺少字碼對應（ToUnicode）時，pdf.js 讀出來的多半是這些
const BROKEN = /[-�\u{f0000}-\u{10fffd}]|\p{Cc}/u;

// 文字層能不能用。none：沒有文字層（掃描檔，或字形畫成路徑），garbled：讀出來的大多是亂碼。
// 這兩種都改用辨識
export function textLayerQuality(runs: TextRun[]): "ok" | "none" | "garbled" {
  const chars = runs.flatMap((r) => Array.from(r.str)).filter((c) => !/\s/.test(c));
  const broken = chars.filter((c) => BROKEN.test(c)).length;
  const letters = chars.filter((c) => !BROKEN.test(c) && /[\p{L}\p{N}]/u.test(c)).length;
  if (letters < 2) return "none";
  return broken > chars.length * 0.2 ? "garbled" : "ok";
}

// --- 頁面上的圖片 ---
//
// 貼進 Word 的截圖、掃描檔這類圖片裡的字不在文字層，要另外辨識。從 pdf.js 的
// getOperatorList() 追蹤座標變換，算出每張圖片畫在畫布上的範圍，只辨識那些地方。
// 算不出位置的畫法回傳 "page"，整頁辨識

// pdf.js 的 OPS 裡用到的幾個，由呼叫的人傳進來，這個檔案不必載入 pdf.js
export interface ImageOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  beginGroup: number;
  endGroup: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageMaskXObject: number;
  paintImageXObjectRepeat: number;
  paintImageMaskXObjectRepeat: number;
  paintImageMaskXObjectGroup: number;
  paintInlineImageXObjectGroup: number;
}

type Matrix = number[];

// 跟 pdf.js 的 Util.transform 相同：先套 n 再套 m
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0]! * n[0]! + m[2]! * n[1]!,
  m[1]! * n[0]! + m[3]! * n[1]!,
  m[0]! * n[2]! + m[2]! * n[3]!,
  m[1]! * n[2]! + m[3]! * n[3]!,
  m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
  m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
];

// 圖片畫在 0 到 1 的單位正方形上，換算到畫布的外框
function unitBox(m: Matrix): Box {
  const pts = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x, y]) => [x! * m[0]! + y! * m[2]! + m[4]!, x! * m[1]! + y! * m[3]! + m[5]!] as const);
  const x = Math.min(...pts.map(([px]) => px));
  const y = Math.min(...pts.map(([, py]) => py));
  return { x, y, w: Math.max(...pts.map(([px]) => px)) - x, h: Math.max(...pts.map(([, py]) => py)) - y };
}

// 太小的圖片放不下看得清的字（圖示、項目符號）
const MIN_SIDE = 16;
// 圖片蓋住大半頁時（掃描檔），整頁辨識
const PAGE_SHARE = 0.6;

export function imageRegions(fnArray: number[], argsArray: unknown[][], ops: ImageOps, viewport: Matrix, width: number, height: number): Box[] | "page" {
  let ctm: Matrix = [...viewport];
  const stack: Matrix[] = [];
  const found: Box[] = [];
  const add = (m: Matrix) => found.push(unitBox(m));
  for (const [i, fn] of fnArray.entries()) {
    const args = argsArray[i] ?? [];
    if (fn === ops.save || fn === ops.beginGroup) stack.push(ctm);
    else if (fn === ops.restore || fn === ops.endGroup || fn === ops.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === ops.transform) ctm = multiply(ctm, args as Matrix);
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = args[0] as Matrix | null;
      if (matrix) ctm = multiply(ctm, Array.from(matrix));
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageMaskXObject) add(ctm);
    else if (fn === ops.paintImageXObjectRepeat) {
      const [, sx, sy, positions] = args as [unknown, number, number, number[]];
      for (let p = 0; p + 1 < positions.length; p += 2) add(multiply(ctm, [sx, 0, 0, sy, positions[p]!, positions[p + 1]!]));
    } else if (fn === ops.paintImageMaskXObjectRepeat) {
      const [, sx, kx, ky, sy, positions] = args as [unknown, number, number, number, number, number[]];
      for (let p = 0; p + 1 < positions.length; p += 2) add(multiply(ctm, [sx, kx, ky, sy, positions[p]!, positions[p + 1]!]));
    } else if (fn === ops.paintImageMaskXObjectGroup) {
      const images = args[0] as { transform?: Matrix }[] | undefined;
      if (!images?.every((image) => image.transform)) return "page";
      for (const image of images) add(multiply(ctm, image.transform!));
    } else if (fn === ops.paintInlineImageXObjectGroup) return "page";
  }
  const regions = found.flatMap((b) => {
    const box = clip(b, width, height);
    return box && box.w >= MIN_SIDE && box.h >= MIN_SIDE ? [box] : [];
  });
  // 重疊的圖片合成一塊，同一個地方不辨識兩次
  const merged: Box[] = [];
  for (const box of regions) {
    let current = box;
    for (let j = merged.length - 1; j >= 0; j--) {
      const other = merged[j]!;
      if (current.x < other.x + other.w && other.x < current.x + current.w && current.y < other.y + other.h && other.y < current.y + current.h) {
        current = union([current, other]);
        merged.splice(j, 1);
      }
    }
    merged.push(current);
  }
  const area = merged.reduce((n, b) => n + b.w * b.h, 0);
  return area > width * height * PAGE_SHARE ? "page" : merged;
}

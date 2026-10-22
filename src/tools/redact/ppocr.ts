import type { Box } from "./index.ts";

// 遮蔽的文字辨識用 PaddleOCR 的 PP-OCRv5 mobile（src/ui/ppocr.ts 載入模型、畫到 canvas 上取像素），
// 這裡是不碰 DOM 的前後處理，有單元測試。參數照 PaddleOCR 3.x 的 OCR 流程預設值：偵測 limit_side_len 64
// （min）、thresh 0.3、box_thresh 0.6、unclip_ratio 1.5，辨識的輸入高度 48、CTC 解碼。長邊的上限從
// PaddleOCR 的 4000 降到 2560：4032×3024 的手機照片照 4000 算，偵測的輸入要 144 MB，手機上記憶體不夠
//
// DB 後處理算最小外接旋轉矩形：分數只算矩形裡的機率、沿著矩形的方向擴張，辨識時把歪的那一行轉正
// 再裁切（PaddleOCR 的 get_rotate_crop_image），高大於寬 1.5 倍的再轉 90 度。只用水平的外接矩形的話，
// 轉歪 3 度的長行外接矩形裡大半是背景，平均機率掉到 0.6 以下整行被丟掉，翻拍與掃描的圖片只找得到
// 三成的文字行（#140 的評測）
//
// 跟 PaddleOCR 不同的地方：
// - 連通區塊用 8 連通找，凸包取每一列最左與最右的像素角，unclip 直接把矩形的長寬各加 2d
//   （pyclipper 擴張出來的圓角再取最小外接矩形，結果相近）
// - 一行一行辨識（batch 1），寬度補到至少 320，不補到同一批裡最寬的那一行

export interface OcrChar {
  c: string;
  prob: number;
  box: Box;
}

export interface Point {
  x: number;
  y: number;
}

// 一行文字的四個角：左上、右上、右下、左下（照 PaddleOCR 的 get_mini_boxes 排列）
export type Quad = [Point, Point, Point, Point];

export interface OcrLine {
  text: string;
  score: number; // 辨識的平均機率
  detScore: number; // 偵測框裡的平均機率
  box: Box; // quad 的外接矩形
  quad: Quad;
  chars: OcrChar[];
}

export function quadBox(q: Point[]): Box {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// 凸包（Andrew 的 monotone chain）
function hull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// 最小外接旋轉矩形（rotating calipers）：中心、沿著邊的單位向量 u、長寬
interface Rect {
  c: Point;
  u: Point;
  w: number;
  h: number;
}
function minAreaRect(h: Point[]): Rect {
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i]!;
    const b = h[(i + 1) % h.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of h) {
      const pu = p.x * u.x + p.y * u.y;
      const pv = -p.x * u.y + p.y * u.x;
      minU = Math.min(minU, pu);
      maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv);
      maxV = Math.max(maxV, pv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { c: { x: cu * u.x - cv * u.y, y: cu * u.y + cv * u.x }, u, w: maxU - minU, h: maxV - minV };
    }
  }
  return best ?? { c: h[0] ?? { x: 0, y: 0 }, u: { x: 1, y: 0 }, w: 0, h: 0 };
}

function corners(r: Rect): Point[] {
  const v = { x: -r.u.y, y: r.u.x };
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([su, sv]) => ({ x: r.c.x + (su! * r.w * r.u.x + sv! * r.h * v.x) / 2, y: r.c.y + (su! * r.w * r.u.y + sv! * r.h * v.y) / 2 }));
}

// 照 get_mini_boxes：依 x 排序，左邊兩點 y 小的是左上，右邊兩點 y 小的是右上
function order(pts: Point[]): Quad {
  const s = [...pts].sort((a, b) => a.x - b.x);
  const [l1, l2, r1, r2] = s as [Point, Point, Point, Point];
  const [tl, bl] = l1.y <= l2.y ? [l1, l2] : [l2, l1];
  const [tr, br] = r1.y <= r2.y ? [r1, r2] : [r2, r1];
  return [tl, tr, br, bl];
}

// 偵測的輸入尺寸：短邊不到 64 時放大，長邊超過 2560 時縮小，再取 32 的倍數
export function detSize(w: number, h: number, limitSide = 64, maxSide = 2560): { w: number; h: number } {
  let ratio = Math.min(w, h) < limitSide ? limitSide / Math.min(w, h) : 1;
  if (Math.max(w, h) * ratio > maxSide) ratio = maxSide / Math.max(w, h);
  const r32 = (v: number) => Math.max(32, Math.round((v * ratio) / 32) * 32);
  return { w: r32(w), h: r32(h) };
}

// DB 後處理：機率圖二值化，找連通區塊，算最小外接旋轉矩形，矩形裡的平均機率夠高才留，
// 沿著矩形的方向往外擴張，換回原圖座標
export function dbBoxes(
  prob: Float32Array,
  W: number,
  H: number,
  scaleX: number,
  scaleY: number,
  { thresh = 0.3, boxThresh = 0.6, unclip = 1.5, minSize = 3, maxCandidates = 1000 } = {},
): { quad: Quad; box: Box; score: number }[] {
  const label = new Int32Array(W * H);
  const out: { quad: Quad; box: Box; score: number }[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < W * H; start++) {
    if (label[start] || prob[start]! <= thresh) continue;
    next++;
    // 每一列最左與最右的像素，凸包只需要這些點
    const rows = new Map<number, [number, number]>();
    stack.push(start);
    label[start] = next;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % W;
      const py = (p - px) / W;
      const row = rows.get(py);
      if (!row) rows.set(py, [px, px]);
      else {
        if (px < row[0]) row[0] = px;
        if (px > row[1]) row[1] = px;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (!label[q] && prob[q]! > thresh) {
            label[q] = next;
            stack.push(q);
          }
        }
      }
    }
    if (next > maxCandidates * 4) break;
    const pts: Point[] = [];
    for (const [y, [x0, x1]] of rows) pts.push({ x: x0, y }, { x: x1 + 1, y }, { x: x0, y: y + 1 }, { x: x1 + 1, y: y + 1 });
    const rect = minAreaRect(hull(pts));
    if (Math.min(rect.w, rect.h) < minSize) continue;
    // box_score_fast：旋轉矩形裡的機率平均
    const bb = quadBox(corners(rect));
    const v = { x: -rect.u.y, y: rect.u.x };
    let sum = 0;
    let n = 0;
    for (let y = Math.max(0, Math.floor(bb.y)); y < Math.min(H, Math.ceil(bb.y + bb.h)); y++)
      for (let x = Math.max(0, Math.floor(bb.x)); x < Math.min(W, Math.ceil(bb.x + bb.w)); x++) {
        const dx = x + 0.5 - rect.c.x;
        const dy = y + 0.5 - rect.c.y;
        if (Math.abs(dx * rect.u.x + dy * rect.u.y) <= rect.w / 2 && Math.abs(dx * v.x + dy * v.y) <= rect.h / 2) {
          sum += prob[y * W + x]!;
          n++;
        }
      }
    const score = n ? sum / n : 0;
    if (score < boxThresh) continue;
    // unclip：往外擴張 面積 × ratio ÷ 周長
    const d = (rect.w * rect.h * unclip) / (2 * (rect.w + rect.h));
    const grown = { ...rect, w: rect.w + 2 * d, h: rect.h + 2 * d };
    if (Math.min(grown.w, grown.h) < minSize + 2) continue;
    const quad = order(
      corners(grown).map((p) => ({ x: Math.min(W, Math.max(0, p.x)) * scaleX, y: Math.min(H, Math.max(0, p.y)) * scaleY })),
    );
    out.push({ quad, box: quadBox(quad), score });
  }
  // 由上而下、由左而右，PaddleOCR 的 sorted_boxes 也是這樣排，同一行（左上角 y 差不到 10 像素）依 x 排
  out.sort((a, b) => (Math.abs(a.quad[0].y - b.quad[0].y) < 10 ? a.quad[0].x - b.quad[0].x : a.quad[0].y - b.quad[0].y));
  return out.slice(0, maxCandidates);
}

// 裁切一行文字：寬是上下兩邊較長的那一條，高是左右兩邊較長的那一條。高大於寬 1.5 倍時
// 照 PaddleOCR 轉 90 度（右邊那一條變成上緣）。回傳轉正之後的左上、右上、左下三個角與長寬
export function cropFrame(q: Quad): { tl: Point; tr: Point; bl: Point; w: number; h: number } {
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = q;
  const w = Math.max(dist(tl, tr), dist(bl, br));
  const h = Math.max(dist(tl, bl), dist(tr, br));
  if (h / w >= 1.5) return { tl: tr, tr: br, bl: tl, w: h, h: w };
  return { tl, tr, bl, w, h };
}

// 把 frame 對應到 width × height 的畫布：canvas 的 setTransform(a, b, c, d, e, f)
export function cropTransform(f: { tl: Point; tr: Point; bl: Point }, width: number, height: number): number[] {
  const u = { x: f.tr.x - f.tl.x, y: f.tr.y - f.tl.y };
  const v = { x: f.bl.x - f.tl.x, y: f.bl.y - f.tl.y };
  const det = u.x * v.y - v.x * u.y;
  // M = diag(width, height) · [u v]⁻¹
  const a = (width * v.y) / det;
  const c = (-width * v.x) / det;
  const b = (-height * u.y) / det;
  const d = (height * u.x) / det;
  return [a, b, c, d, -(a * f.tl.x + c * f.tl.y), -(b * f.tl.x + d * f.tl.y)];
}

// 辨識的輸入寬度：高度縮到 48，寬度照比例（無條件進位），右邊補 0 到至少 320，
// 照 PaddleOCR 的 resize_norm_img
export function recWidth(w: number, h: number): { width: number; padded: number } {
  const width = Math.max(8, Math.ceil((48 * w) / h));
  return { width, padded: Math.max(320, width) };
}

// CTC 解碼。輸出是 [T, C] 的機率，0 是空白，1 到 C-2 是字典，最後一個是空格。
// 每個字記下第一個與最後一個時間步，換算成這一行裡的橫向位置
export function ctcDecode(
  data: Float32Array,
  T: number,
  C: number,
  dict: string[],
  frame: { tl: Point; tr: Point; bl: Point },
  width: number,
  padded: number,
): { text: string; score: number; chars: OcrChar[] } {
  const raw: { c: string; prob: number; first: number; last: number }[] = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bp = -Infinity;
    const row = t * C;
    for (let c = 0; c < C; c++) {
      const v = data[row + c]!;
      if (v > bp) {
        bp = v;
        best = c;
      }
    }
    if (best !== 0 && best === prev) {
      const last = raw.at(-1)!;
      last.last = t;
      last.prob = Math.max(last.prob, bp);
    } else if (best !== 0) {
      raw.push({ c: best === C - 1 ? " " : dict[best - 1] ?? "", prob: bp, first: t, last: t });
    }
    prev = best;
  }
  // 模型的 T 個時間步平均分在補寬之後的寬度上，文字只佔前面 width / padded。
  // 位置先算成這一行裡的比例（0 是左邊、1 是右邊），再沿著這一行的方向換回原圖
  const step = padded / width / T;
  const centers = raw.map((r) => ((r.first + r.last + 1) / 2) * step);
  const height = 48 / width; // 一個字高佔這一行寬度的比例
  const at = (t: number, s: number) => ({
    x: frame.tl.x + t * (frame.tr.x - frame.tl.x) + s * (frame.bl.x - frame.tl.x),
    y: frame.tl.y + t * (frame.tr.y - frame.tl.y) + s * (frame.bl.y - frame.tl.y),
  });
  const chars: OcrChar[] = [];
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k]!;
    if (r.c === " ") continue;
    const gapL = k > 0 ? (centers[k]! - centers[k - 1]!) / 2 : k + 1 < raw.length ? (centers[k + 1]! - centers[k]!) / 2 : height / 2;
    const gapR = k + 1 < raw.length ? (centers[k + 1]! - centers[k]!) / 2 : gapL;
    // 相鄰兩個字的分界取中心的中點，但至少蓋住這個字自己出現的那幾個時間步
    const left = Math.max(0, Math.min(centers[k]! - gapL, r.first * step));
    const right = Math.min(1, Math.max(centers[k]! + gapR, (r.last + 1) * step));
    chars.push({ c: r.c, prob: r.prob, box: quadBox([at(left, 0), at(right, 0), at(right, 1), at(left, 1)]) });
  }
  const text = raw.map((r) => r.c).join("");
  const score = raw.length ? raw.reduce((a, r) => a + r.prob, 0) / raw.length : 0;
  return { text, score, chars };
}

// 交給 findPii 的「字」：漢字與全形符號一個字一個，連在一起的英數與 @ . - _ 這類符號合成一個，
// 空白斷開。findPii 用空白把字接回一行，電話與 Email 要是一個字才比對得到，框也只框到那一段
const ASCII = /^[\x21-\x7e]$/;
export function words(line: OcrLine): { text: string; box: Box }[] {
  const out: { text: string; box: Box; ascii: boolean }[] = [];
  const textChars = [...line.text];
  let k = 0;
  for (const ch of textChars) {
    if (ch === " ") {
      out.push({ text: "", box: line.box, ascii: false }); // 斷開
      continue;
    }
    const c = line.chars[k++];
    if (!c) break;
    const last = out.at(-1);
    const ascii = ASCII.test(ch);
    if (ascii && last?.ascii && last.text) {
      last.text += ch;
      const b = last.box;
      last.box = quadBox([
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: c.box.x, y: c.box.y },
        { x: c.box.x + c.box.w, y: c.box.y + c.box.h },
      ]);
    } else out.push({ text: ch, box: c.box, ascii });
  }
  return out.filter((w) => w.text).map(({ text, box }) => ({ text, box }));
}

// 「框起所有文字」要框的行。照片、頭像與標點的碎片常被認成一個字，分數都很低（合成截圖裡 0.04 到 0.58）。
// 只丟一個字而且分數低於 0.6 的，分數低但字多的行是縮小、壓縮過的小字，裡面可能有個資，要留著
export function keepLine(line: { text: string; score: number }): boolean {
  return [...line.text.trim()].length > 1 || line.score >= 0.6;
}

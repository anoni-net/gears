import { type PdqHash, distance } from "./pdq.ts";

// 查證的相似圖片：把暫存區裡內容相近的圖片分在同一組並排，讓讀者自己判斷哪一張比較接近原檔。
// 兩層：PDQ 感知雜湊（pdq.ts，不用模型，預設），以及讀者選擇下載的 DINOv2 small 影像特徵（src/ui/dino.worker.ts）。
// 只給線索，不顯示分數。不碰 DOM，有單元測試（tests/unit/similar.spec.ts）。
//
// 門檻與分組方式照社群工作區的評測（research/gears-similar/01-pdq-dinov2.md，64 張 CC0 照片與 1,189 個變化版本）：
// - PDQ：8 個方向取最小的距離，31 以內算相近（README 建議的門檻）。這次的資料裡判斷相近的全部是同一張圖的不同版本，
//   41 組困難負例（連拍、同一地點同一角度、構圖相近）的距離最小 90
// - DINOv2：整張壓成 224 × 224，CLS 特徵正規化之後 1 − cos 在 0.15 以內算相近。找得回裁切、加字與加框，
//   同一個場景連拍、同一地點同一角度拍的另一張照片也常常在這個範圍裡（test 那一半連拍 7 組有 5 組、同一地點 6 組有 3 組）
// - 分組用「組裡每一對都相近才併」（complete linkage）。相連就併的話，富士山的原圖、版本、連拍與前一天的照片
//   會全部連成一組

export const PDQ_THRESHOLD = 31;
// PDQ README：品質 49 以下的雜湊不要用。純色、幾乎全黑的圖品質低，兩張這種圖的雜湊會很接近。
// 評測的 1,253 張都在 49 以上，這條規則沒有在評測裡用到
export const PDQ_MIN_QUALITY = 50;
export const DINO_THRESHOLD = 0.15;

export interface ImageSig {
  id: number;
  pdq?: PdqHash;
  dino?: Float32Array; // 已經正規化（長度 1）
}

export type Layer = "pdq" | "dino";

const pdqUsable = (s: ImageSig) => !!s.pdq && s.pdq.quality >= PDQ_MIN_QUALITY;

// 8 個方向：一邊的每個方向對另一邊原本的方向，兩邊各算一次取最小（跟評測的 grouping.mjs 相同）
export function pdqDistance(a: ImageSig, b: ImageSig): number | null {
  if (!pdqUsable(a) || !pdqUsable(b)) return null;
  let best = 256;
  for (const d of a.pdq!.dihedral) best = Math.min(best, distance(d, b.pdq!.hash));
  for (const d of b.pdq!.dihedral) best = Math.min(best, distance(d, a.pdq!.hash));
  return best;
}

export function dinoDistance(a: ImageSig, b: ImageSig): number | null {
  if (!a.dino || !b.dino || a.dino.length !== b.dino.length) return null;
  let dot = 0;
  for (let i = 0; i < a.dino.length; i++) dot += a.dino[i]! * b.dino[i]!;
  return 1 - dot;
}

// 兩張圖的接近程度換成同一把尺：1 以下算相近，越小越近。PDQ 與 DINOv2 的距離各自除以門檻，取比較近的那一個
export function closeness(a: ImageSig, b: ImageSig): number {
  const p = pdqDistance(a, b);
  const d = dinoDistance(a, b);
  return Math.min(p === null ? Infinity : p / PDQ_THRESHOLD, d === null ? Infinity : d / DINO_THRESHOLD);
}

// 哪一層判斷相近：PDQ 優先，PDQ 沒有判斷相近時才看 DINOv2。不相近時是 null
export function pairLayer(a: ImageSig, b: ImageSig): Layer | null {
  const p = pdqDistance(a, b);
  if (p !== null && p <= PDQ_THRESHOLD) return "pdq";
  const d = dinoDistance(a, b);
  if (d !== null && d <= DINO_THRESHOLD) return "dino";
  return null;
}

export interface SimilarGroup {
  ids: number[]; // 依傳進來的順序
  // 組裡每一對都是 PDQ 判斷相近時是 pdq，畫面寫「可能是同一張圖縮小、重新壓縮、調色或翻轉之後的版本」。
  // 有任何一對只有 DINOv2 判斷相近時是 dino，畫面另外寫「也可能是同一個場景、同一地點同一角度拍的另一張照片」
  layer: Layer;
  // 組裡某一張也跟這一組以外的圖相近（另一組的成員或沒有分組的圖），畫面在那一張下面註明
  alsoNear: { id: number; near: number[] }[];
}

// 組裡每一對都相近才併：每一次合併「兩組之間最遠的一對」最近的那兩組，直到再也沒有兩組可以合併。
// 每張圖只放進一組。同一張照片的版本很多時會分成好幾組（轉 90 度、聊天截圖常自成一組），沒有分在同一組不代表不是同一張
export function groupSimilar(sigs: readonly ImageSig[]): SimilarGroup[] {
  const n = sigs.length;
  const c: number[][] = sigs.map((a, i) => sigs.map((b, j) => (i === j ? 0 : closeness(a, b))));
  let clusters: number[][] = sigs.map((_, i) => [i]);
  for (;;) {
    let best: [number, number, number] | null = null;
    for (let x = 0; x < clusters.length; x++)
      for (let y = x + 1; y < clusters.length; y++) {
        let far = 0;
        for (const i of clusters[x]!) for (const j of clusters[y]!) far = Math.max(far, c[i]![j]!);
        if (far <= 1 && (!best || far < best[2])) best = [x, y, far];
      }
    if (!best) break;
    const [x, y] = best;
    clusters[x] = [...clusters[x]!, ...clusters[y]!].sort((a, b) => a - b);
    clusters = clusters.filter((_, k) => k !== y);
  }
  const groupOf = new Array<number>(n);
  clusters.forEach((g, k) => g.forEach((i) => (groupOf[i] = k)));
  return clusters
    .filter((g) => g.length > 1)
    .sort((a, b) => a[0]! - b[0]!)
    .map((g) => {
      let layer: Layer = "pdq";
      for (const i of g) for (const j of g) if (i < j && pairLayer(sigs[i]!, sigs[j]!) !== "pdq") layer = "dino";
      const alsoNear = g
        .map((i) => ({ id: sigs[i]!.id, near: sigs.flatMap((s, j) => (groupOf[j] !== groupOf[i] && c[i]![j]! <= 1 ? [s.id] : [])) }))
        .filter((x) => x.near.length);
      return { ids: g.map((i) => sigs[i]!.id), layer, alsoNear };
    });
}

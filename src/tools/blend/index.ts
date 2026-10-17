// 縮成常見尺寸並重新壓縮。手機照片的原始解析度與相機的壓縮設定（量化表、色度取樣）
// 跟機型有關，清掉中繼資料之後仍然看得出是哪一類手機拍的。縮到社群平台常見的尺寸、
// 用一般的參數重新壓縮之後，這兩項跟大多數人分享的照片一樣。這裡只算尺寸，不碰 DOM。

// 長邊的選項，第一個是預設值
export const LONG_EDGES = [2048, 1600, 1280] as const;
export type LongEdge = (typeof LONG_EDGES)[number];

// JPEG 的品質，固定一個常見的值，不跟著原檔
export const QUALITY = 0.85;

// 等比縮到長邊不超過 longEdge，原本就比較小的不放大
export function targetSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= longEdge) return { width, height };
  const scale = longEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// 一次縮小太多會產生鋸齒，每次最多縮一半，最後一步再縮到目標尺寸
export function downscaleSteps(width: number, height: number, target: { width: number; height: number }): { width: number; height: number }[] {
  const steps: { width: number; height: number }[] = [];
  let w = width;
  let h = height;
  while (w / 2 > target.width && h / 2 > target.height) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    steps.push({ width: w, height: h });
  }
  if (w !== target.width || h !== target.height) steps.push(target);
  return steps;
}

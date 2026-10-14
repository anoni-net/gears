// 遮蔽的純邏輯：框的座標換算與「遮住的地方真的是黑的」的抽查點。
// 解碼、塗黑與重新編碼要用到 canvas，在 src/ui/RedactEditor.tsx。
//
// 只用實心黑色。馬賽克與模糊保留了原本內容的統計特徵，文字尤其容易被還原。

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 兩個角的座標換成左上角加寬高，並限制在圖片範圍內
export function boxFromPoints(ax: number, ay: number, bx: number, by: number, width: number, height: number): Box {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const x1 = clamp(Math.min(ax, bx), width);
  const y1 = clamp(Math.min(ay, by), height);
  const x2 = clamp(Math.max(ax, bx), width);
  const y2 = clamp(Math.max(ay, by), height);
  return { x: Math.floor(x1), y: Math.floor(y1), w: Math.ceil(x2 - Math.floor(x1)), h: Math.ceil(y2 - Math.floor(y1)) };
}

// 太小的框多半是手指點一下，不當成遮蔽範圍
export function isUsable(box: Box, min = 4): boolean {
  return box.w >= min && box.h >= min;
}

// 每個框抽查九個點：四角往內縮、四邊中點與中心。JPEG 的壓縮在邊緣會跟旁邊的顏色
// 混在一起，所以往內縮幾個像素再看。
export function samplePoints(box: Box, inset = 3): [number, number][] {
  const ix = Math.min(inset, Math.floor(box.w / 2));
  const iy = Math.min(inset, Math.floor(box.h / 2));
  const xs = [box.x + ix, box.x + Math.floor(box.w / 2), box.x + box.w - 1 - ix];
  const ys = [box.y + iy, box.y + Math.floor(box.h / 2), box.y + box.h - 1 - iy];
  return xs.flatMap((x) => ys.map((y) => [x, y] as [number, number]));
}

// 夠黑：三個色版都不超過門檻。Brave 的防指紋會讓 canvas 的輸出帶一點雜訊，
// JPEG 也會有些微誤差，所以不要求剛好是 0。
export function isDark(r: number, g: number, b: number, threshold = 24): boolean {
  return r <= threshold && g <= threshold && b <= threshold;
}

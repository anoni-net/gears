// 列印文件的追蹤點。很多彩色雷射印表機在每一頁印上肉眼幾乎看不到的淡黃色小點，編著印表機的
// 序號與列印的時間，拍照或掃描紙本交出去時會跟著過去。這裡只處理像素，不碰 DOM：
//
// - 只看黃色：淡黃色在藍色頻道最暗，用「紅綠兩色比藍色亮多少」畫成灰階，黑色的文字變成白色，
//   淡黃色的小點變成看得到的深色圖案
// - 去掉淡黃色：接近白色的淡黃色像素改成白色，其他顏色保留。螢光筆那種飽和的黃色藍色頻道很暗，
//   不會被當成追蹤點
// - 轉成黑白：灰階之後依亮度分成黑與白，淡黃色的點比門檻亮，一起變成白色
//
// 不解碼點陣代表的序號與時間。那是用來追查文件來源的，讀者是要保護消息來源的人。

export type DotsMode = "yellow" | "black-white";

// 紅綠兩色比藍色亮多少，越大越黃
const yellowness = (r: number, g: number, b: number) => Math.min(r, g) - b;

// 追蹤點那種接近白色的淡黃色：紅綠都很亮、藍色稍微暗一些，紅綠差不多
export function isFaintYellow(r: number, g: number, b: number): boolean {
  return Math.min(r, g) >= 190 && b >= 140 && yellowness(r, g, b) >= 12 && Math.abs(r - g) <= 40;
}

// 只看黃色：越黃越暗，其他顏色（包括黑色的字）都變成白色。紙張本身常帶一點點黃，
// 差距在 4 以內的當成白色。回傳淡黃色像素的個數
export function revealYellow(data: Uint8ClampedArray): number {
  let faint = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (isFaintYellow(r, g, b)) faint++;
    const v = 255 - Math.min(255, Math.max(0, yellowness(r, g, b) - 4) * 8);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return faint;
}

// 追蹤點是稀疏的小點。淡黃色占了畫面的一大片時，比較可能是光線讓整張紙偏黃
export type DotsFinding = "found" | "tinted" | "none";
export function judge(faint: number, pixels: number): DotsFinding {
  if (!faint) return "none";
  return faint / pixels > 0.15 ? "tinted" : "found";
}

// 去掉淡黃色：改成白色，回傳改了幾個像素
export function removeYellow(data: Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!isFaintYellow(data[i]!, data[i + 1]!, data[i + 2]!)) continue;
    data[i] = data[i + 1] = data[i + 2] = 255;
    changed++;
  }
  return changed;
}

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// Otsu 法找出把亮度分成兩群最好的門檻。拍照的紙張常偏灰，固定的門檻容易整頁變黑。
// 限制在 100 到 200 之間：整頁幾乎都是白紙時，門檻不會低到把淡淡的字也變成白色
export function otsuThreshold(data: Uint8ClampedArray): number {
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) histogram[Math.round(luma(data[i]!, data[i + 1]!, data[i + 2]!))]!++;
  const total = data.length / 4;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * histogram[v]!;
  let back = 0;
  let backSum = 0;
  let best = 0;
  let threshold = 160;
  for (let v = 0; v < 256; v++) {
    back += histogram[v]!;
    if (!back) continue;
    const fore = total - back;
    if (!fore) break;
    backSum += v * histogram[v]!;
    const between = back * fore * (backSum / back - (sum - backSum) / fore) ** 2;
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  return Math.min(200, Math.max(100, threshold));
}

// 轉成黑白，回傳用的門檻
export function toBlackWhite(data: Uint8ClampedArray): number {
  const threshold = otsuThreshold(data);
  for (let i = 0; i < data.length; i += 4) {
    const v = luma(data[i]!, data[i + 1]!, data[i + 2]!) > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return threshold;
}

export function applyDots(data: Uint8ClampedArray, mode: DotsMode) {
  if (mode === "yellow") removeYellow(data);
  else toBlackWhite(data);
}

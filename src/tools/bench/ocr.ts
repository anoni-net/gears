import samples from "./ocr-samples.json" with { type: "json" };

// 裝置量測的文字辨識（src/ui/OcrBench.tsx）：三張固定的範例截圖與正確答案，以及字錯率的算法。
// 截圖取自 #140 評測用的合成截圖（社群工作區的 research/gears-ocr/），內容是虛構的，不含個資。
// 不在瀏覽器裡畫：各裝置的字型不同，結果就不能互相比較

export interface OcrSample {
  id: "phone" | "desktop" | "lowres";
  file: string; // 相對於網站的根目錄
  sha256: string;
  width: number;
  height: number;
  lines: string[];
}

export const OCR_SAMPLES = samples as OcrSample[];

// 比對時拿掉空白：辨識結果的空白跟原文常常不同，算進去的話字錯率反映的是排版
const normalize = (text: string) => [...text.replace(/\s+/g, "")];

// 字錯率：編輯距離除以正確答案的字數。跟 #140 的評測同一個算法，數字可以對照
export function cer(reference: string, hypothesis: string): number {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  if (!ref.length) return hyp.length ? 1 : 0;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++)
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[hyp.length]! / ref.length;
}

export function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

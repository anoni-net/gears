// 影片的關鍵影格：從影片裡挑出畫面明顯不同的幾格，讀者拿去做反向圖片搜尋。
//
// 這裡只有純邏輯：在哪些時間點取樣、兩個畫面差多少、挑出哪幾格。影片的解碼與擷取在
// src/ui/video-frames.ts，用瀏覽器的 <video> 跳到每個時間點，畫成小張的灰階圖交給這裡比對。
//
// 不用影片檔裡標記的 I 影格：編碼器多半每一兩秒就放一格，跟畫面有沒有換沒有關係，
// 數量又多。改成比對畫面，換場景的地方才留下來。

// 比對用的小圖是 SIZE × SIZE 的灰階，不管原本的長寬比。只用來判斷畫面有沒有換
export const SIZE = 32;

export interface Sample {
  time: number; // 秒
  luma: Uint8Array; // SIZE × SIZE 的灰階
}

export interface PickOptions {
  max: number; // 最多留幾格
  min: number; // 畫面幾乎不動的影片，至少平均挑幾格
  threshold: number; // 跟上一格留下的畫面平均差多少（0 到 255）才算換了場景
}

export const DEFAULT_PICK: PickOptions = { max: 16, min: 4, threshold: 24 };

// 取樣的時間點：最多 max 個，間隔至少 minStep 秒，取在每一段的中間，避開片頭與片尾的黑畫面
export function sampleTimes(duration: number, max = 240, minStep = 0.5): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const step = Math.max(minStep, duration / max);
  const times: number[] = [];
  for (let t = step / 2; t < duration && times.length < max; t += step) times.push(Math.round(t * 1000) / 1000);
  return times.length ? times : [duration / 2];
}

// 兩張小圖每個點的灰階差距，取平均
export function difference(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

// 幾乎是單一顏色的畫面（黑幕、白畫面、淡入淡出的中間），拿去搜尋沒有意義
export function isBlank(luma: Uint8Array): boolean {
  let sum = 0;
  for (const v of luma) sum += v;
  const mean = sum / luma.length;
  let variance = 0;
  for (const v of luma) variance += (v - mean) ** 2;
  return Math.sqrt(variance / luma.length) < 6;
}

// 挑出畫面明顯不同的時間點，依時間排序。
// 1. 略過單一顏色的畫面
// 2. 跟上一格留下的畫面比，差距超過門檻才留。跟「上一格留下的」比，慢慢移動的鏡頭累積夠多也會留一格
// 3. 太多時留差距最大的幾格（第一格一定留）
// 4. 只找到一格時（畫面幾乎不動）在剩下的取樣裡平均補上。找到兩格以上就不補，補進來的會是
//    同一個場景的重複畫面
// evenly 表示沒有找到換場景的地方、這幾格是平均挑的，畫面上另外說明
export function pickFrames(samples: Sample[], options: PickOptions = DEFAULT_PICK): { times: number[]; evenly: boolean } {
  const usable = samples.filter((s) => !isBlank(s.luma));
  if (!usable.length) return { times: samples.length ? [samples[Math.floor(samples.length / 2)]!.time] : [], evenly: false };

  const kept: { time: number; score: number; luma: Uint8Array }[] = [{ time: usable[0]!.time, score: Infinity, luma: usable[0]!.luma }];
  for (const s of usable.slice(1)) {
    const score = difference(kept[kept.length - 1]!.luma, s.luma);
    if (score >= options.threshold) kept.push({ time: s.time, score, luma: s.luma });
  }

  let times = kept.length > options.max
    ? [...kept].sort((a, b) => b.score - a.score).slice(0, options.max).map((k) => k.time)
    : kept.map((k) => k.time);

  const want = Math.min(options.min, usable.length);
  const evenly = times.length <= 1 && times.length < want;
  if (evenly) {
    const taken = new Set(times);
    for (let i = 0; i < want && times.length < want; i++) {
      const s = usable[Math.round(((i + 0.5) * usable.length) / want - 0.5)]!;
      if (!taken.has(s.time)) {
        taken.add(s.time);
        times.push(s.time);
      }
    }
  }
  return { times: times.sort((a, b) => a - b), evenly };
}

// 檔名與畫面上的時間：1:05.3，超過一小時 1:02:05.3
export function clock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const s = (tenths % 600) / 10;
  const m = Math.floor(tenths / 600) % 60;
  const h = Math.floor(tenths / 36000);
  const ss = s.toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// 放進暫存區的檔名。不沿用影片的檔名，原檔名常帶著人名或日期
export const frameName = (seconds: number) => `frame-${clock(seconds).replace(/:/g, "-")}.jpg`;

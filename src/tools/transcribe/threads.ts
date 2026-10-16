// 逐字稿預設同時使用幾個 CPU 核心。核心越多越快，差距很大：15 核心的 MacBook Pro 上，
// 同一段錄音用 4 個核心要 40 分鐘、8 個 8 分鐘、12 個 4 分鐘。但選超過電腦實際的核心數，
// 執行緒會互相搶 CPU，反而變慢。
//
// navigator.hardwareConcurrency 只會比實際少、不會比實際多：Brave 回報 2 到真實數字之間的
// 隨機數，Safari 桌機最多回報 8、iPhone 一律回報 2，Firefox 防指紋時固定回報 2。所以：
// - 回報 12 以上，電腦至少真的有 12 個核心，用 12（16 留給讀者自己選）
// - 會回報真實數字的瀏覽器（Chrome、Edge、一般設定的 Firefox），用不超過回報數字的最大選項
// - 數字不可信的（Brave、Safari、回報 2 以下），用 8，現在的電腦大多有 8 個以上
// - iPhone、iPad 用 4，手機的記憶體與散熱比較吃緊
// - Firefox 用 1：多個核心時推論環境偶爾建不起來、也不報錯，畫面停在「下載模型中」（2 個核心
//   也會），1 個核心從沒停過。原因還沒找到，讀者可以自己選更多核心

export const THREAD_OPTIONS = [1, 2, 4, 8, 12, 16];

export interface ThreadHints {
  reported: number; // navigator.hardwareConcurrency
  brave: boolean;
  safari: boolean;
  mobileApple: boolean; // iPhone、iPad
  firefox: boolean;
}

export function defaultThreads({ reported, brave, safari, mobileApple, firefox }: ThreadHints): number {
  if (firefox) return 1;
  if (mobileApple) return 4;
  if (reported >= 12) return 12;
  const cores = brave || safari || reported <= 2 ? 8 : reported;
  return [...THREAD_OPTIONS].reverse().find((n) => n <= Math.min(cores, 12)) ?? 1;
}

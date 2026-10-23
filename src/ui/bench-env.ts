import { canvasReadable } from "./canvas-access.ts";

// 裝置量測（src/ui/BenchPage.tsx）的裝置資訊，文字辨識與語言模型兩個區塊共用。
// hardwareConcurrency 在 Brave、Safari、Firefox 都比實際少（見 AGENTS.md「逐字稿」），
// deviceMemory 只有 Chromium 有、最多回報 8，所以只當參考

export interface BenchEnv {
  cores: number;
  isolated: boolean;
  memory: number | null; // GB
  canvas: boolean; // 讀得到 canvas 的像素，遮蔽的自動尋找才能用
  gpu: { vendor?: string; architecture?: string; f16: boolean; fallback: boolean } | null;
}

export async function probeEnv(): Promise<BenchEnv> {
  const env: BenchEnv = {
    cores: navigator.hardwareConcurrency || 0,
    isolated: self.crossOriginIsolated,
    memory: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
    canvas: canvasReadable(),
    gpu: null,
  };
  type Adapter = { features: Set<string>; info?: { vendor?: string; architecture?: string; isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  if (adapter)
    env.gpu = {
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture,
      f16: adapter.features.has("shader-f16"),
      fallback: !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter),
    };
  return env;
}

// 有實體顯示卡：軟體模擬的比 CPU 慢很多，量了沒有意義
export const hasGpu = (env: BenchEnv | null) => !!env?.gpu && !env.gpu.fallback;

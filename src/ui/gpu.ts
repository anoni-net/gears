import type { GpuInfo } from "../tools/transcribe/device.ts";

// 這台裝置的顯示卡能不能給逐字稿用（src/tools/transcribe/device.ts）。只問瀏覽器一次。
// 拿不到 adapter、瀏覽器沒有 WebGPU 時回傳 null
let probe: Promise<GpuInfo | null> | null = null;

interface Adapter {
  isFallbackAdapter?: boolean;
  info?: { isFallbackAdapter?: boolean };
  limits: { maxStorageBufferBindingSize: number; maxBufferSize: number };
}

// 測試用的網址參數，跟找人臉的 ?debug-faces 一樣只影響判斷：
// ?gpu=force 不問瀏覽器，當成顯示卡可以用（沒有 WebGPU 時 Worker 失敗，測改用 CPU 的路徑），
// ?gpu=any 連軟體模擬的顯示卡也用（在沒有實體顯示卡的機器上測 WebGPU 的流程）
const override = new URLSearchParams(location.search).get("gpu");

export function detectGpu(): Promise<GpuInfo | null> {
  probe ??= (async () => {
    if (override === "force") return { fallback: false, maxBuffer: Number.MAX_SAFE_INTEGER };
    // isFallbackAdapter 在舊版的規格掛在 adapter 上，新版移到 adapter.info
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter().catch(() => null);
    if (!adapter) return null;
    return {
      fallback: override !== "any" && !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter),
      maxBuffer: Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize),
    };
  })();
  return probe;
}

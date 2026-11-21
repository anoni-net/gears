import { useEffect, useState } from "preact/hooks";
import { detectGpu } from "./gpu.ts";
import { wasmAvailable } from "./wasm.ts";

// 這台裝置能不能執行模型：WebAssembly 有沒有被關掉（鎖定模式）、有沒有可以用的顯示卡。
// 桌面的定位說明（src/ui/DeskIntro.tsx）與設計原則頁的即時檢查（src/ui/AboutPage.tsx）共用，不另外偵測。
// 顯示卡沿用逐字稿的 detectGpu（只問瀏覽器一次），軟體模擬的顯示卡比 CPU 還慢，當成沒有。
// 偵測只在畫面上顯示，不送出、不記錄

export interface DeviceSupport {
  wasm: boolean;
  gpu: "checking" | "yes" | "no";
}

export function useDeviceSupport(): DeviceSupport {
  const [wasm] = useState(wasmAvailable);
  const [gpu, setGpu] = useState<DeviceSupport["gpu"]>("checking");
  useEffect(() => {
    let alive = true;
    void detectGpu()
      .catch(() => null)
      .then((info) => alive && setGpu(info && !info.fallback ? "yes" : "no"));
    return () => {
      alive = false;
    };
  }, []);
  return { wasm, gpu };
}

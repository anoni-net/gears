// 逐字稿要不要用顯示卡（WebGPU）。判斷在畫面上做（src/ui/TranscribeEditor.tsx），Worker 照著用，
// 建立推論環境或辨識失敗時改用 CPU（src/ui/transcribe.worker.ts）。
//
// WebGPU 用 4 位元的模型（models.json 的 webgpu）：q8 用到的 MatMulInteger、DynamicQuantizeLinear
// 在 onnxruntime 的 WebGPU 上沒有實作，大部分運算會退回 CPU。CPU（wasm）維持 q8，瀏覽器裡實測
// q4 慢了約 1.7 倍。

export type Device = "webgpu" | "wasm";

export interface GpuInfo {
  fallback: boolean; // 軟體模擬的顯示卡（例如 SwiftShader），實測比 wasm 慢 15 到 29 倍
  maxBuffer: number; // maxStorageBufferBindingSize 與 maxBufferSize 較小的那個
}

// need 是模型 decoder 的詞嵌入表大小（models.json 的 webgpu.buffer），整塊要放進一個緩衝區
export function gpuUsable(gpu: GpuInfo | null, need: number): boolean {
  return !!gpu && !gpu.fallback && gpu.maxBuffer >= need;
}

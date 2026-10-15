/// <reference types="vite/client" />

// 建置時的 commit（vite.config.ts）
declare const __GEARS_COMMIT__: string;

declare module "libheif-js/libheif-wasm/libheif.js" {
  const factory: (options: { wasmBinary: ArrayBuffer }) => unknown;
  export default factory;
}

// Transformers.js 帶的 onnxruntime-web（src/ui/speaker-embed.ts 跟它共用同一份），介面跟找人臉用的
// onnxruntime-web 相同
declare module "*/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs" {
  export * from "onnxruntime-web";
}

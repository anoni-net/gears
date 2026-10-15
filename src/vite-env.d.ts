/// <reference types="vite/client" />

// 建置時的 commit（vite.config.ts）
declare const __GEARS_COMMIT__: string;

declare module "libheif-js/libheif-wasm/libheif.js" {
  const factory: (options: { wasmBinary: ArrayBuffer }) => unknown;
  export default factory;
}

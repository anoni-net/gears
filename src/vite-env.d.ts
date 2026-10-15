/// <reference types="vite/client" />

declare module "libheif-js/libheif-wasm/libheif.js" {
  const factory: (options: { wasmBinary: ArrayBuffer }) => unknown;
  export default factory;
}

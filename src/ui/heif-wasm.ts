// libheif（LGPL-3.0）編譯成 WebAssembly 的版本，來自 npm 的 libheif-js，原封不動使用。
// Brave、Chrome、Firefox 不能解碼 HEIC，只有遇到 HEIC 而且瀏覽器解不開時才下載（約 1.5 MB）。
// 這個模組會被打包成獨立的檔案，跟工作台的程式分開，讀者可以換成自己編譯的 libheif。
// 授權全文與原始碼來源見 licenses/libheif.txt。

import factory from "libheif-js/libheif-wasm/libheif.js";
import wasmUrl from "libheif-js/libheif-wasm/libheif.wasm?url";

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: ImageData, done: (result: ImageData | null) => void): void;
  free?(): void;
}

interface Libheif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
}

let libheif: Promise<Libheif> | null = null;

function load(): Promise<Libheif> {
  libheif ??= fetch(wasmUrl)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((wasmBinary) => factory({ wasmBinary }) as Libheif);
  return libheif;
}

// 解碼主要的那張影像。libheif 會套用 irot、imir，輸出的方向跟照片 App 裡看到的一樣
export async function decodeHeif(data: Uint8Array): Promise<ImageData> {
  const lib = await load();
  const images = new lib.HeifDecoder().decode(data);
  const image = images[0];
  if (!image) throw new Error("decode");
  const out = new ImageData(image.get_width(), image.get_height());
  await new Promise<void>((resolve, reject) => image.display(out, (result) => (result ? resolve() : reject(new Error("display")))));
  for (const img of images) img.free?.();
  return out;
}

import { type Format, MIME } from "../core/bytes.ts";
import { type C2paCheck, needsInterim, summarizeStore } from "../tools/verify/c2pa.ts";
import { wasmAvailable } from "./wasm.ts";

// 驗證 C2PA 內容憑證。c2pa-web（MIT，裡面是 c2pa-rs 編成的 WebAssembly，見 licenses/c2pa.txt）在
// 查證遇到內容憑證時才下載，WebAssembly 約 9 MB（壓縮後約 2 MB）。驗證在它自己的 Worker 裡執行，
// 信任清單建置時內嵌（src/tools/verify/c2pa-trust/，scripts/c2pa-trust.mjs 每月核對）。
//
// 不連線：遠端的資訊清單（remoteManifestFetch）與線上的撤銷查詢（ocspFetch）都關掉，信任清單
// 直接給內容，不給網址。頁面的 CSP 本來也只允許連自己的網域。

export type C2paResult = { check: C2paCheck } | { error: "wasm-unavailable" | "unreadable" };

type Loaded = Awaited<ReturnType<typeof load>>;
let loading: Promise<Loaded> | undefined;

async function load() {
  const [{ createC2pa, Context, Reader }, wasm, official, tsa, anchors, allowed, config] = await Promise.all([
    import("@contentauth/c2pa-web"),
    import("@contentauth/c2pa-web/resources/c2pa.wasm?url"),
    import("../tools/verify/c2pa-trust/official.pem?raw"),
    import("../tools/verify/c2pa-trust/official-tsa.pem?raw"),
    import("../tools/verify/c2pa-trust/interim-anchors.pem?raw"),
    import("../tools/verify/c2pa-trust/interim-allowed.pem?raw"),
    import("../tools/verify/c2pa-trust/interim-store.cfg?raw"),
  ]);
  // Worker 從 blob: 網址建立，相對路徑會解析錯，給完整的網址
  const c2pa = await createC2pa({ wasmSrc: new URL(wasm.default, location.href).href });
  const verify = { verifyTrust: true, verifyTimestampTrust: true, remoteManifestFetch: false, ocspFetch: false };
  return {
    c2pa,
    Reader,
    official: new Context({ verify, trust: { trustAnchors: `${official.default}\n${tsa.default}` } }),
    interim: new Context({ verify, trust: { trustAnchors: anchors.default, allowedList: allowed.default, trustConfig: config.default } }),
  };
}

export async function checkC2pa(blob: Blob, format: Format): Promise<C2paResult> {
  if (!wasmAvailable()) return { error: "wasm-unavailable" };
  try {
    const { c2pa, Reader, official, interim } = await (loading ??= load());
    const read = async (context: typeof official) => {
      const reader = await Reader.fromBlob(c2pa, MIME[format], blob, context);
      if (!reader) return undefined;
      try {
        return await reader.manifestStore();
      } finally {
        await reader.free();
      }
    };
    let store = await read(official);
    if (!store) return { error: "unreadable" };
    let list: "official" | "interim" = "official";
    if (needsInterim(store)) {
      const second = await read(interim);
      if (second?.validation_state === "Trusted") {
        store = second;
        list = "interim";
      }
    }
    const check = summarizeStore(store, list);
    return check ? { check } : { error: "unreadable" };
  } catch {
    return { error: "unreadable" };
  }
}

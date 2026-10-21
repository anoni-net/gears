import type { Signature } from "../tools/verify/examine.ts";
import { type TrustStore, pemToDer, verifyPdfSignature } from "../tools/verify/pdf-signature.ts";

// PDF 數位簽章的驗證（#128）。pkijs（BSD-3-Clause，見 licenses/pkijs.txt）在 PDF 帶著簽章時才下載，
// 密碼運算用瀏覽器的 crypto.subtle，只在 HTTPS 這類安全的頁面才有，沒有時說明沒有驗證。
// 信任清單建置時內嵌（src/tools/verify/pdf-trust/，scripts/pdf-trust.mjs 每月核對），不連線。
// 時間戳記服務另外採信 C2PA 正式清單裡的時間戳記服務清單（src/tools/verify/c2pa-trust/official-tsa.pem）

let trust: Promise<TrustStore> | undefined;

async function loadTrust(): Promise<TrustStore> {
  const [roots, cas, tsa] = await Promise.all([
    import("../tools/verify/pdf-trust/grca-roots.pem?raw"),
    import("../tools/verify/pdf-trust/gpki-cas.pem?raw"),
    import("../tools/verify/c2pa-trust/official-tsa.pem?raw"),
  ]);
  return { roots: pemToDer(roots.default), intermediates: pemToDer(cas.default), tsaRoots: pemToDer(tsa.default) };
}

export async function checkPdfSignatures(bytes: Uint8Array, signatures: Signature[]): Promise<void> {
  for (const sig of signatures) {
    if (!sig.contents || !sig.byteRange) continue;
    if (!globalThis.crypto?.subtle) {
      sig.check = { integrity: "unknown", signature: "unavailable", chain: "not-checked" };
      continue;
    }
    try {
      sig.check = await verifyPdfSignature(bytes, { byteRange: sig.byteRange, contents: sig.contents }, await (trust ??= loadTrust()));
    } catch {
      sig.check = { integrity: "unknown", signature: "unsupported", chain: "not-checked" };
    }
  }
}

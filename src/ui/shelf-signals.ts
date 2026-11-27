import { useEffect, useState } from "preact/hooks";
import type { Version } from "../core/tray.ts";
import { SIGNATURE_MAX, looksLikeSignature } from "../tools/software-verify/signature.ts";
import type { Signals } from "./shelf.ts";

// 檔案畫面的工具列表要用到、需要讀檔案結構才知道的訊號（src/ui/shelf.ts）。打開檔案時算一次，
// 依版本記住。只讀結構，不解碼影像也不載入模型：文件開啟前檢查的規則、PDF 的 %%EOF、簽章檔與純文字的開頭。
// 讀不了或太大的檔案就沒有訊號，工具列表照樣列出工具，只是不建議

const cache = new Map<number, Signals>();
const DOC_MAX = 64 * 1024 * 1024;

// PDF 每一次存檔結尾是一個 %%EOF，線性化的 PDF 開頭多一個。舊版本的確切數量由查證判斷
// （src/tools/verify/examine.ts 會切開每一版確認讀得出來），這裡只估一個數字當成建議的理由
export function pdfRevisionCount(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  let eofs = 0;
  for (let at = text.indexOf("%%EOF"); at >= 0; at = text.indexOf("%%EOF", at + 5)) eofs++;
  const linearized = text.slice(0, 1024).includes("/Linearized");
  return Math.max(0, eofs - (linearized ? 1 : 0) - 1);
}

// 判斷不出格式的檔案，開頭看起來是不是純文字（TXT、CSV、程式碼這類）。安裝檔、映像檔與壓縮過的資料
// 開頭幾 KB 一定有 0 這個位元組，文字沒有。UTF-16 的文字每個英數字都帶著 0，靠開頭的 BOM 認出來。
// 不限定 UTF-8，Big5 的 CSV 也算文字：只看 0 與換行、Tab 以外的控制字元，超過 1% 就當成二進位的資料
export const TEXT_SAMPLE = 8 * 1024;
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0c && b !== 0x0d && b !== 0x1b) control++;
  }
  return control <= bytes.length / 100;
}

async function compute(version: Version): Promise<Signals> {
  const signals: Signals = {};
  const { format, blob } = version;
  if (format === "unknown") {
    // 大檔案也讀開頭，Tails 的映像檔超過 256 MB，仍然要列出下載的軟體驗證
    const head = new Uint8Array(await blob.slice(0, TEXT_SAMPLE).arrayBuffer());
    signals.text = looksLikeText(head);
    if (blob.size <= SIGNATURE_MAX) signals.signature = looksLikeSignature(head.subarray(0, 64));
    return signals;
  }
  if (version.large) return signals;
  const { CHECK_FORMATS, checkDocument } = await import("../tools/doc-check/index.ts");
  if (!CHECK_FORMATS.includes(format) || blob.size > DOC_MAX) return signals;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try {
    const { items } = await checkDocument(bytes, format);
    signals.docCheck = { connect: items.filter((i) => i.kind === "connect").length, code: items.filter((i) => i.kind === "code").length };
  } catch {
    // 讀不了的文件沒有訊號
  }
  if (format === "pdf") signals.pdfRevisions = pdfRevisionCount(bytes);
  return signals;
}

export function useSignals(version: Version): Signals {
  const [signals, setSignals] = useState<Signals>(() => cache.get(version.id) ?? {});
  useEffect(() => {
    const known = cache.get(version.id);
    if (known) return setSignals(known);
    let alive = true;
    setSignals({});
    void compute(version)
      .catch(() => ({}))
      .then((s) => {
        cache.set(version.id, s);
        if (alive) setSignals(s);
      });
    return () => {
      alive = false;
    };
  }, [version.id]);
  return signals;
}

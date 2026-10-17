import { useEffect, useState } from "preact/hooks";
import type { Version } from "../core/tray.ts";
import { SIGNATURE_MAX, looksLikeSignature } from "../tools/software-verify/signature.ts";
import type { Signals } from "./shelf.ts";

// 檔案畫面的工具列表要用到、需要讀檔案結構才知道的訊號（src/ui/shelf.ts）。打開檔案時算一次，
// 依版本記住。只讀結構，不解碼影像也不載入模型：文件開啟前檢查的規則、PDF 的 %%EOF、簽章檔的開頭。
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

async function compute(version: Version): Promise<Signals> {
  const signals: Signals = {};
  if (version.large) return signals;
  const { format, blob } = version;
  if (format === "unknown" && blob.size <= SIGNATURE_MAX) {
    signals.signature = looksLikeSignature(new Uint8Array(await blob.slice(0, 64).arrayBuffer()));
    return signals;
  }
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

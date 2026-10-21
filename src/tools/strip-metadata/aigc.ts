import type { Finding } from "../../core/tool.ts";
import { type Tc260Label, tc260InXmp } from "../verify/provenance.ts";

// GB 45438 的隱式標識。值是服務提供者編碼，個人提供的服務在編碼裡以明文帶著身分證號、
// 手機號碼、護照號碼或網號，畫面上拆開列出（src/ui/provider-text.ts），讀者看過再決定要不要清除
export function aigcFindings(labels: (Tc260Label | undefined)[]): Finding[] {
  const found = labels.filter((l): l is Tc260Label => !!l);
  if (!found.length) return [];
  const codes = found.flatMap((l) => [l.producer, l.propagator]).filter((c): c is string => !!c);
  return codes.length ? codes.map((value) => ({ code: "aigc", value })) : [{ code: "aigc" }];
}

export const xmpAigc = (xmp: Uint8Array) => aigcFindings(tc260InXmp(new TextDecoder().decode(xmp)));

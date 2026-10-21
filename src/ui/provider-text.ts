import { t, tDynamic } from "../i18n/index.ts";
import { parseProviderCode } from "../tools/verify/provenance.ts";

// GB 45438 的服務提供者編碼拆成主體、綁定方式與號碼，查證與清除中繼資料的檢查結果共用。
// 個人的號碼照實列出：讀者可能在查證收到的檔案，也可能是自己的檔案，都要先看到檔案裡
// 實際有什麼，再決定要不要清除中繼資料
export function providerText(code: string): string {
  const p = parseProviderCode(code);
  if (!p) return code;
  let text = t("verify.provider", { subject: tDynamic(`verify.provider.${p.subject}`), binding: tDynamic(`verify.provider.${p.binding}`), number: p.number });
  if (p.service) text = t("verify.provider.with", { text, more: tDynamic(`verify.provider.${p.service}`) });
  if (p.model) text = t("verify.provider.with", { text, more: t("verify.provider.model", { value: p.model }) });
  return t("verify.prov.code", { text, code });
}

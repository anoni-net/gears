import { t } from "../i18n/index.ts";
import { routeUrl } from "../router.ts";

// 工具畫面只寫操作，誰可得知什麼、保存多久這類隱私的做法寫在隱私說明（AGENTS.md「介面文字」），
// 畫面上需要提到時只放這個連結。section 是隱私說明各段的 id（privacy-models 這類），由 scrollToHash 捲過去。
// 開新分頁：編輯畫面裡還沒套用、還沒下載的結果，換頁之後就不見了
export function PrivacyLink({ section, label = "common.privacyMore" }: { section?: string; label?: "common.privacyMore" | "common.privacyHf" }) {
  return (
    <a href={`${routeUrl("privacy")}${section ? `#privacy-${section}` : ""}`} target="_blank" rel="noopener" data-testid="privacy-link">
      {t(label)}
    </a>
  );
}

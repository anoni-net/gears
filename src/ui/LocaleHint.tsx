import { useState } from "preact/hooks";
import { getLocale, localeInfo, messagesOf } from "../i18n/index.ts";
import { suggestLocale } from "../i18n/suggest.ts";
import { switchLocale } from "../router.ts";
import { IS_ONION } from "../site.ts";

// 瀏覽器的語言跟網址的語系不同時，在頁首下方建議換一個語系。語系仍然由網址決定，
// 不自動轉址、不記住選擇（不用 cookie 或 localStorage）：關掉之後在站內換頁不再出現，
// 重新整理或重新打開才會再出現一次。文字用建議的那個語系寫，讀者才看得懂。
// onion 版不顯示：Tor Browser 為了防止指紋辨識，一律回報英文
const initial = getLocale();
const suggestion =
  IS_ONION || typeof navigator === "undefined" ? null : suggestLocale(navigator.languages?.length ? navigator.languages : [navigator.language], initial);
let closed = false;

export function LocaleHint() {
  const [, rerender] = useState(0);
  // 讀者自己在頁尾換過語系，就不再建議
  if (getLocale() !== initial) closed = true;
  if (!suggestion || closed) return null;
  const messages = messagesOf(suggestion);
  const close = () => {
    closed = true;
    rerender((n) => n + 1);
  };
  return (
    <div class="frame">
      <div class="update-bar locale-hint" lang={localeInfo(suggestion).lang} data-testid="locale-hint">
        <span>{messages["app.localeHint"]}</span>
        <span class="buttons">
          <button
            type="button"
            class="primary"
            onClick={() => {
              closed = true;
              switchLocale(suggestion);
            }}
          >
            {messages["app.localeSwitch"]}
          </button>
          <button type="button" onClick={close}>
            {messages["app.updatedClose"]}
          </button>
        </span>
      </div>
    </div>
  );
}

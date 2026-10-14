import { t } from "../i18n/index.ts";
import { classify } from "../tools/qr-read/index.ts";
import { CopyButton } from "./CopyButton.tsx";

// 讀出來的 QR code 內容。網址可以送去網址檢查，Wi-Fi 拆成欄位顯示。
export function QrContentView({ text, onOpenTool }: { text: string; onOpenTool(id: string, preset?: string): void }) {
  const content = classify(text);
  return (
    <div class="qr-content">
      {content.kind === "wifi" ? (
        <dl class="wifi">
          <dt>{t("qr.ssid")}</dt>
          <dd>{content.ssid}</dd>
          {content.password ? (
            <>
              <dt>{t("qr.password")}</dt>
              <dd>{content.password}</dd>
            </>
          ) : null}
          <dt>{t("qr.security")}</dt>
          <dd>{content.security}</dd>
        </dl>
      ) : null}
      <output class="secret" data-testid="qr-text">
        {text}
      </output>
      <div class="buttons">
        <CopyButton text={content.kind === "wifi" ? content.password || text : text} label={content.kind === "wifi" && content.password ? t("qrread.copyPassword") : undefined} />
        {content.kind === "url" ? (
          <button type="button" onClick={() => onOpenTool("url-check", content.url)}>
            {t("qrread.checkUrl")}
          </button>
        ) : null}
      </div>
      {content.kind === "url" ? <p class="hint">{t("qrread.urlNote")}</p> : null}
    </div>
  );
}

import { t } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icon-paths.ts";

// 設計原則頁的三張示意圖（src/ui/AboutPage.tsx）。圖形是放大的 MDI 圖示、外框與箭頭，標籤是一般的文字，
// 三個語系各自換行，深淺色跟著 CSS 變數。整句的說明放在 figcaption，圖裡不放 h2、h3，不進左欄的本頁目錄。
// 內容跟頁面的文字一致：伺服器經手的只寫跟檔案有關的兩件事（存取紀錄另外寫在說明），
// SHA-256 照 about.models.open.3 寫比對的時機，確認流程停在「套用」，不說成每個工具都會留下新版本

function Node({ icon, title, note, tone }: { icon: IconName; title: string; note?: string; tone?: "accent" | "danger" }) {
  return (
    <div class={tone ? `fig-node ${tone}` : "fig-node"}>
      <span class="fig-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span class="fig-text">
        <strong>{title}</strong>
        {note ? <small>{note}</small> : null}
      </span>
    </div>
  );
}

const Arrow = () => (
  <span class="fig-arrow" aria-hidden="true">
    <Icon name="arrow-down" />
  </span>
);

// 總覽：兩層設計與裝置的邊界。檔案、工具與模型都在分頁裡，跟檔案有關、會經過伺服器的只有模型下載與遠端傳送的密文
export function LayersFigure() {
  return (
    <figure class="about-fig" data-testid="about-fig-layers">
      <div class="fig-device">
        <p class="fig-label">
          <Icon name="monitor-cellphone" />
          {t("about.fig.layers.device")}
        </p>
        <Node icon="brain" title={t("about.fig.layers.model")} note={t("about.fig.layers.model.note")} tone="accent" />
        <Node icon="tools" title={t("about.fig.layers.tools")} note={t("about.fig.layers.tools.note")} />
        <Node icon="file-outline" title={t("about.fig.layers.file")} note={t("about.fig.layers.file.note")} />
      </div>
      <ul class="fig-cross">
        {/* 模型從伺服器下載到裝置（箭頭朝上），遠端傳送的密文兩個方向都有 */}
        <li>
          <span class="fig-arrow up" aria-hidden="true">
            <Icon name="arrow-down" />
          </span>
          <Node icon="cloud-download-outline" title={t("about.fig.layers.download")} note={t("about.fig.layers.download.note")} />
          <span class="fig-arrow up" aria-hidden="true">
            <Icon name="arrow-down" />
          </span>
        </li>
        <li>
          <span class="fig-arrow both" aria-hidden="true">
            <Icon name="arrow-down" />
            <Icon name="arrow-down" />
          </span>
          <Node icon="send-lock-outline" title={t("about.fig.layers.relay")} note={t("about.fig.layers.relay.note")} />
          <span class="fig-arrow both" aria-hidden="true">
            <Icon name="arrow-down" />
            <Icon name="arrow-down" />
          </span>
        </li>
      </ul>
      <div class="fig-outside">
        <Node icon="server-outline" title={t("about.fig.layers.server")} />
      </div>
      <figcaption>{t("about.fig.layers.caption")}</figcaption>
    </figure>
  );
}

// 模型檔的檢查：下載、比對 SHA-256，對得上才使用
export function VerifyFigure() {
  return (
    <figure class="about-fig fig-steps" data-testid="about-fig-verify">
      <ol>
        <li>
          <Node icon="cloud-download-outline" title={t("about.fig.verify.download")} />
        </li>
        <li>
          <Arrow />
          <Node icon="fingerprint" title={t("about.fig.verify.hash")} note={t("about.fig.verify.hash.note")} />
        </li>
        <li class="fig-branch">
          <Arrow />
          <Node icon="check-circle-outline" title={t("about.fig.verify.match")} tone="accent" />
          <Node icon="close-circle-outline" title={t("about.fig.verify.mismatch")} tone="danger" />
        </li>
      </ol>
      <figcaption>{t("about.fig.verify.caption")}</figcaption>
    </figure>
  );
}

// 模型的結果：模型標出、你確認、才套用
export function ConfirmFigure() {
  return (
    <figure class="about-fig fig-steps" data-testid="about-fig-confirm">
      <ol>
        <li>
          <Node icon="brain" title={t("about.fig.confirm.mark")} note={t("about.fig.confirm.mark.note")} />
        </li>
        <li>
          <Arrow />
          <Node icon="account-check-outline" title={t("about.fig.confirm.you")} note={t("about.fig.confirm.you.note")} tone="accent" />
        </li>
        <li>
          <Arrow />
          <Node icon="file-outline" title={t("about.fig.confirm.apply")} note={t("about.fig.confirm.apply.note")} />
        </li>
      </ol>
      <figcaption>{t("about.fig.confirm.caption")}</figcaption>
    </figure>
  );
}

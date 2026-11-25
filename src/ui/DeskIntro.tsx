import { getLocale, t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { useDeviceSupport } from "./device-support.ts";
import { Icon } from "./Icon.tsx";
import { TAGS } from "./tool-tags.ts";

// 桌面最上方的兩段說明，寫出 Gears 的定位（AGENTS.md「定位」）：每個工具在瀏覽器裡就能完成，
// 標著大腦圖示（開源本機模型）的工具可以再用這台裝置的算力執行開源模型。這是 Gears 的定位，
// 「檔案在你的瀏覽器裡處理」只寫在這裡，工具畫面與暫存區不再重複（AGENTS.md「介面文字」）
//
// 每一段後面的「了解更多」連到設計原則頁（src/ui/AboutPage.tsx）的對應段落，捲動由 src/app.tsx 的 scrollToHash 負責。
// 兩個連結的文字相同，讀螢幕軟體另外唸出是哪一段（desk.intro.moreLabel）
//
// 第二段下面一行寫這台裝置的支援狀況，讀者知道模型會跑得快還是慢，回報問題時也看得出是哪一種環境。
// 偵測在 src/ui/device-support.ts，設計原則頁的即時檢查也用同一份

type Device = "checking" | "gpu" | "cpu" | "noWasm";

function More({ section, title }: { section: string; title: string }) {
  return (
    <a
      class="desk-intro-more"
      href={`${routeUrl("about")}#${section}`}
      aria-label={t("desk.intro.moreLabel", { title })}
      onClick={(e) => onRouteClick(e, () => navigate("about", section))}
    >
      {t("desk.intro.more")}
    </a>
  );
}

export function DeskIntro() {
  const support = useDeviceSupport();
  const device: Device = !support.wasm ? "noWasm" : support.gpu === "checking" ? "checking" : support.gpu === "yes" ? "gpu" : "cpu";

  // 英文的句子之間空一格，中文不空
  const sep = getLocale() === "en" ? " " : "";

  return (
    <section class="desk-intro" aria-label={t("desk.intro.label")}>
      <div>
        <h2>{t("desk.intro.browser.title")}</h2>
        <p>
          {t("desk.intro.browser.body")}
          {sep}
          <More section="browser" title={t("desk.intro.browser.title")} />
        </p>
      </div>
      <div>
        <h2>
          <span class="tool-tag" aria-hidden="true">
            <Icon name={TAGS.model.icon} />
          </span>
          {t("desk.intro.model.title")}
        </h2>
        <p>
          {t("desk.intro.model.body")}
          {sep}
          <More section="models" title={t("desk.intro.model.title")} />
        </p>
        <p class={`desk-device desk-device-${device}`} data-testid="desk-device" role="status">
          {tDynamic(`desk.device.${device}`)}{" "}
          {device === "checking" ? null : (
            <a href={routeUrl("bench")} onClick={(e) => onRouteClick(e, () => navigate("bench"))}>
              {t("desk.device.more")}
            </a>
          )}
        </p>
      </div>
    </section>
  );
}

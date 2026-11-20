import { useEffect, useState } from "preact/hooks";
import { t, tDynamic } from "../i18n/index.ts";
import { navigate, onRouteClick, routeUrl } from "../router.ts";
import { Icon } from "./Icon.tsx";
import { detectGpu } from "./gpu.ts";
import { TAGS } from "./tool-tags.ts";
import { wasmAvailable } from "./wasm.ts";

// 桌面最上方的兩段說明，寫出 Gears 的定位（AGENTS.md「定位」）：每個工具在瀏覽器裡就能完成，
// 標著大腦圖示（開源本機模型）的工具可以再用這台裝置的算力執行開源模型。「檔案在你的瀏覽器裡處理」在桌面上
// 只寫在這裡，暫存區的說明改用 tray.hint.home。工具頁沒有這兩段，暫存區仍用 tray.hint 寫這一句（AGENTS.md「介面文字」）
//
// 第二段下面一行寫這台裝置的支援狀況，讀者知道模型會跑得快還是慢，回報問題時也看得出是哪一種環境。
// 偵測只在畫面上顯示，不送出、不記錄。顯示卡沿用逐字稿的 detectGpu（只問瀏覽器一次），軟體模擬的
// 顯示卡比 CPU 還慢，當成沒有

type Device = "checking" | "gpu" | "cpu" | "noWasm";

export function DeskIntro() {
  const [device, setDevice] = useState<Device>(() => (wasmAvailable() ? "checking" : "noWasm"));
  useEffect(() => {
    if (device !== "checking") return;
    let alive = true;
    void detectGpu()
      .catch(() => null)
      .then((gpu) => alive && setDevice(gpu && !gpu.fallback ? "gpu" : "cpu"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section class="desk-intro" aria-label={t("desk.intro.label")}>
      <div>
        <h2>{t("desk.intro.browser.title")}</h2>
        <p>{t("desk.intro.browser.body")}</p>
      </div>
      <div>
        <h2>
          <span class="tool-tag tag-model" aria-hidden="true">
            <Icon name={TAGS.model.icon} />
          </span>
          {t("desk.intro.model.title")}
        </h2>
        <p>{t("desk.intro.model.body")}</p>
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

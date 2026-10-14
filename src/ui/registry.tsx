import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/index.ts";
import type { CreateToolProps } from "./types.ts";

// 從空白開始的工具各自帶一個填寫用的介面。src/tools/index.ts 的 createTools
// 列出 id，這裡對應到元件。元件與它用到的函式庫在打開工具時才下載，桌面維持輕量。
const loaders: Record<string, () => Promise<ComponentType<CreateToolProps>>> = {
  qrcode: () => import("./QrTool.tsx").then((m) => m.QrTool),
  passphrase: () => import("./PassphraseTool.tsx").then((m) => m.PassphraseTool),
};

export function CreateToolView({ id, ...props }: CreateToolProps & { id: string }) {
  const [View, setView] = useState<ComponentType<CreateToolProps> | null>(null);
  useEffect(() => {
    let alive = true;
    setView(null);
    void loaders[id]!().then((component) => {
      if (alive) setView(() => component);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return View ? <View {...props} /> : <p class="hint">{t("app.loading")}</p>;
}

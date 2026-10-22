import type { IconName } from "./icon-paths.ts";

// 桌面工具卡片上的圖示標籤：讀者在打開工具之前就該知道的事，例如會在瀏覽器裡執行模型、
// 會跳出相機的權限詢問。標籤的名稱一律用名詞，完整的意思寫在圖示說明（tag.<id>.desc）。不拿來標功能特色，每張卡片最多兩個（tests/unit/tool-meta.spec.ts 會檢查）。
// 圖示的意思寫在桌面最下方的「圖示說明」，只列出有工具用到的標籤。
//
// 標籤一律中性灰（src/styles.css 的 .tool-tag），不另訂代表色：標籤是提醒，不是分類，靠圖示本身分辨。
// 卡片與圖示說明用同一個樣式。
//
// 新增標籤：在 TAGS 加一筆，三個語系加上 tag.<id> 與 tag.<id>.desc，在 src/ui/tool-meta.ts 的工具填上
// tags。各工具可以另外寫一句補充（tag.<id>.<工具 id>），會放進讀螢幕軟體唸的名稱與滑鼠移上去的提示。
// 能從程式自動判斷的標籤，在 tool-meta.spec.ts 加一條比對，標了沒用到、用到沒標都會失敗
export const TAGS = {
  model: { icon: "brain" }, // 在瀏覽器裡執行模型，第一次使用時下載
  camera: { icon: "camera-outline" }, // 會用到相機，瀏覽器會先詢問
} as const satisfies Record<string, { icon: IconName }>;

export type TagId = keyof typeof TAGS;

// 卡片與圖示說明的排列順序
export const TAG_ORDER = Object.keys(TAGS) as TagId[];

export const MAX_TAGS = 2;

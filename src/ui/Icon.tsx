import { ICON_PATHS, type IconName } from "./icon-paths.ts";

// 圖示一律搭配文字使用，本身不帶替代文字
export function Icon({ name, class: className }: { name: IconName; class?: string }) {
  return (
    <svg class={className ? `icon ${className}` : "icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} fill="currentColor" />
    </svg>
  );
}

// 圓形的圖示圈，顏色代表工具的類別，跟社群首頁的圖示圈同一種樣式
export function IconCircle({ name, cat }: { name: IconName; cat: Category }) {
  return (
    <span class={`ic cat-${cat}`}>
      <Icon name={name} />
    </span>
  );
}

// 品牌素材頁「圖示的分類色」裡的類別，工作台用到其中兩類
export type Category = "privacy" | "secure";

import type { Box } from "./index.ts";
import type { ModelMatch } from "./pii-model.ts";
import { PII_KINDS, type PiiKind, type PiiMatch, overlaps } from "./pii.ts";

// 檔案畫面的「檢查畫面內容」找到的東西（src/ui/ScreenCheck.tsx）。找人臉與辨識文字跟遮蔽的
// 自動尋找共用同一套（src/ui/redact-detect.ts），座標是檢查的那個版本的原圖像素
export interface ScreenFound {
  faces: Box[];
  maybe: Box[]; // 可能是臉，遮蔽時畫成虛線，讀者點一下才變成遮蔽框
  pii: PiiMatch[];
  // 個資辨識模型另外找到的（讀者按下「找人名、地址與單位」才有，#187），已經拿掉跟規則重疊的（modelOnly）
  names?: ModelMatch[];
}

export const foundAnything = (found: ScreenFound) => found.faces.length + found.maybe.length + found.pii.length + (found.names?.length ?? 0) > 0;

// 交給遮蔽的框：確定的人臉、規則與模型找到的個資，重疊的只留一個（同一支電話跨行比對時會在兩行各給一個框，不重疊的照樣留著）
export function screenBoxes(found: ScreenFound): Box[] {
  const boxes: Box[] = [];
  for (const box of [...found.faces, ...found.pii.map((m) => m.box), ...(found.names ?? []).map((m) => m.box)])
    if (!boxes.some((b) => overlaps(b, box))) boxes.push(box);
  return boxes;
}

// 可能是臉的範圍，已經被確定的框蓋住的不再列
export const screenMaybe = (found: ScreenFound, boxes: Box[]) => found.maybe.filter((m) => !boxes.some((b) => overlaps(b, m)));

// 畫面上的摘要只列每一類的數量，不列找到的文字：檔案畫面不是讀者決定要不要遮的地方，
// 看到的位置與內容在遮蔽的畫面裡確認
export function piiCounts(pii: PiiMatch[]): { kind: PiiKind; n: number }[] {
  return PII_KINDS.map((kind) => ({ kind, n: pii.filter((m) => m.kind === kind).length })).filter((c) => c.n > 0);
}

// 模型找到的範圍裡，規則已經找到的電話、Email 不重複算：跟規則的框重疊的拿掉，模型自己找到的互相重疊時也只留一個。
// 畫面上的數量與交給遮蔽的框都用這一份，兩邊對得上
export function modelOnly(pii: PiiMatch[], found: ModelMatch[]): ModelMatch[] {
  const kept: ModelMatch[] = [];
  for (const m of found) if (!pii.some((p) => overlaps(p.box, m.box)) && !kept.some((k) => overlaps(k.box, m.box))) kept.push(m);
  return kept;
}

// 模型的類別在畫面上分成人名、地址、單位，規則沒找到的電話、Email、證號與其他類別合成「其他個資」
export type ScreenModelKind = "person" | "address" | "org" | "other";
export const SCREEN_MODEL_KINDS: readonly ScreenModelKind[] = ["person", "address", "org", "other"];

const modelKind = (m: ModelMatch): ScreenModelKind => (m.kind === "person" || m.kind === "address" || m.kind === "org" ? m.kind : "other");

export function modelCounts(names: ModelMatch[]): { kind: ScreenModelKind; n: number }[] {
  return SCREEN_MODEL_KINDS.map((kind) => ({ kind, n: names.filter((m) => modelKind(m) === kind).length })).filter((c) => c.n > 0);
}

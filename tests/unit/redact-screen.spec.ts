import { expect, test } from "@playwright/test";
import type { ModelMatch } from "../../src/tools/redact/pii-model.ts";
import type { PiiMatch } from "../../src/tools/redact/pii.ts";
import { foundAnything, modelCounts, modelOnly, piiCounts, screenBoxes, screenMaybe } from "../../src/tools/redact/screen.ts";

const pii = (kind: PiiMatch["kind"], x: number): PiiMatch => ({ kind, text: "", box: { x, y: 200, w: 80, h: 20 } });
const named = (kind: ModelMatch["kind"], x: number, y = 300): ModelMatch => ({ kind, text: "", box: { x, y, w: 80, h: 20 } });

test("交給遮蔽的框：人臉與個資合在一起，重疊的只留一個", () => {
  const face = { x: 0, y: 0, w: 100, h: 100 };
  const boxes = screenBoxes({
    faces: [face],
    maybe: [],
    // 同一支電話跨行比對時在兩行各給一個框，不重疊的兩個都留著。落在人臉裡的 Email（重疊超過較小那個框的一半）拿掉
    pii: [pii("phone", 200), pii("phone", 400), { kind: "email", text: "", box: { x: 20, y: 40, w: 60, h: 20 } }],
  });
  expect(boxes).toEqual([face, { x: 200, y: 200, w: 80, h: 20 }, { x: 400, y: 200, w: 80, h: 20 }]);
});

test("可能是臉的範圍，已經被確定的框蓋住的不再列", () => {
  const found = { faces: [], maybe: [{ x: 0, y: 0, w: 50, h: 50 }, { x: 300, y: 0, w: 50, h: 50 }], pii: [pii("email", 10)] };
  const boxes = [{ x: 10, y: 10, w: 50, h: 50 }];
  expect(screenMaybe(found, boxes)).toEqual([{ x: 300, y: 0, w: 50, h: 50 }]);
});

test("摘要只列每一類的數量，照規則的順序，沒有的類別不列", () => {
  expect(piiCounts([pii("email", 0), pii("phone", 100), pii("email", 200)])).toEqual([
    { kind: "phone", n: 1 },
    { kind: "email", n: 2 },
  ]);
  expect(piiCounts([])).toEqual([]);
});

test("只有可能是臉的範圍也算找到東西，什麼都沒有時不算", () => {
  expect(foundAnything({ faces: [], maybe: [], pii: [] })).toBe(false);
  expect(foundAnything({ faces: [], maybe: [{ x: 0, y: 0, w: 10, h: 10 }], pii: [] })).toBe(true);
});

test("個資辨識模型找到的：跟規則的框重疊的不重複算，模型自己重疊的只留一個", () => {
  const rules = [pii("phone", 0)];
  // 模型也找到同一支電話（跟規則的框重疊）、一個人名，以及同一個人名的兩個框（重疊）
  const kept = modelOnly(rules, [named("phone", 0, 200), named("person", 200), named("person", 210), named("address", 400)]);
  expect(kept).toEqual([named("person", 200), named("address", 400)]);
});

test("模型的類別分成人名、地址、單位，其他的合成其他個資，順序固定", () => {
  expect(modelCounts([named("id", 0), named("org", 100), named("person", 200), named("person", 300), named("email", 400)])).toEqual([
    { kind: "person", n: 2 },
    { kind: "org", n: 1 },
    { kind: "other", n: 2 },
  ]);
  expect(modelCounts([])).toEqual([]);
});

test("模型找到的框也交給遮蔽，只有模型找到東西時也算找到", () => {
  const found = { faces: [], maybe: [], pii: [pii("phone", 0)], names: [named("person", 200)] };
  expect(screenBoxes(found)).toEqual([{ x: 0, y: 200, w: 80, h: 20 }, { x: 200, y: 300, w: 80, h: 20 }]);
  expect(foundAnything({ faces: [], maybe: [], pii: [], names: [named("org", 0)] })).toBe(true);
  expect(foundAnything({ faces: [], maybe: [], pii: [], names: [] })).toBe(false);
});

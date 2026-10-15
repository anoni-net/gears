import { expect, test } from "@playwright/test";
import { type Word, findPii, overlaps } from "../../src/tools/redact/pii.ts";

// 每個字一個框，一行一個陣列
const line = (y: number, ...texts: string[]): Word[] => texts.map((text, i) => ({ text, box: { x: i * 100, y, w: 90, h: 20 } }));

test("找出電話、Email、身分證、卡號、網址與帳號", () => {
  const matches = findPii([
    line(0, "電話", "0912", "345", "678"),
    line(30, "Email:", "jane.doe@example.org"),
    line(60, "身分證", "A123456789"),
    line(90, "卡號", "4111", "1111", "1111", "1111"),
    line(120, "https://example.org/u/jane"),
    line(150, "追蹤", "@jane_doe"),
    line(180, "香港", "+852", "9123", "4567"),
    line(210, "帳號", "0123456789012"),
  ]);
  expect(matches.map((m) => m.kind)).toEqual(["phone", "email", "id", "card", "url", "handle", "phone", "number"]);
  // 電話被切成三個字，框是三個字合起來的範圍
  expect(matches[0]!.box).toEqual({ x: 100, y: 0, w: 290, h: 20 });
});

test("日期、金額、短的數字不當成個資", () => {
  expect(findPii([line(0, "2024-06-01", "NT$1,200", "第", "3", "頁", "12:30")])).toEqual([]);
});

test("重疊一半以上才算同一個框", () => {
  expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 10, h: 10 })).toBe(true);
  expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 8, y: 8, w: 10, h: 10 })).toBe(false);
});

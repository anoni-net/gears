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

test("香港身分證、帶國碼的手機、部分遮住的手機", () => {
  const matches = findPii([line(0, "身份證", "A123456(7)"), line(30, "電話", "+86", "135", "1234", "5678"), line(60, "手機", "0966***218")]);
  expect(matches.map((m) => [m.kind, m.text])).toEqual([
    ["id", "A123456(7)"],
    ["phone", "+86 135 1234 5678"],
    ["phone", "0966***218"],
  ]);
});

test("換行拆開的 Email：兩行各給一個框", () => {
  const matches = findPii([line(0, "媒體窗口是", "press.union@exam"), line(25, "ple.org")]);
  expect(matches.map((m) => [m.kind, m.text])).toEqual([
    ["email", "press.union@example.org"],
    ["email", "press.union@example.org"],
  ]);
  expect(matches[0]!.box).toEqual({ x: 100, y: 0, w: 90, h: 20 });
  expect(matches[1]!.box).toEqual({ x: 0, y: 25, w: 90, h: 20 });
});

test("換行拆開的 Email：下一行單獨看是完整的 Email，上一行的前半段一樣框起來", () => {
  const matches = findPii([line(0, "信箱填", "r119"), line(25, "21047@example.edu.tw")]);
  expect(matches.map((m) => [m.text, m.box.y])).toEqual([
    ["r11921047@example.edu.tw", 0],
    ["r11921047@example.edu.tw", 25],
  ]);
});

test("換行拆開的電話：上一行只對到半截的換成接起來的", () => {
  const matches = findPii([line(0, "電話", "02-2963-01"), line(25, "88", "人很好")]);
  expect(matches.map((m) => [m.kind, m.text, m.box.y])).toEqual([
    ["phone", "02-2963-0188", 0],
    ["phone", "02-2963-0188", 25],
  ]);
});

test("不是換行拆開的不接：離太遠、沒有對齊、接在漢字或空白後面", () => {
  // 下一行離得很遠，是另一段
  expect(findPii([line(0, "寫信到", "tips@exam"), line(200, "ple.org")])).toEqual([]);
  // 下一行在右邊另一欄
  const right = [{ text: "ple.org", box: { x: 600, y: 25, w: 90, h: 20 } }];
  expect(findPii([line(0, "寫信到", "tips@exam"), right])).toEqual([]);
  // 上一行的結尾是漢字
  expect(findPii([line(0, "電話", "0912"), line(25, "號碼", "345678")])).toEqual([]);
  // 清單裡相鄰的兩項：上一行的電話不併進下一行的 Email，上一行完整的 Email 不接下一行的英文
  const list = findPii([line(0, "Call", "0912-345-678"), line(25, "jane.doe@example.org"), line(50, "See", "you")]);
  expect(list.map((m) => [m.kind, m.text])).toEqual([
    ["phone", "0912-345-678"],
    ["email", "jane.doe@example.org"],
  ]);
});

test("日期、金額、短的數字不當成個資", () => {
  expect(findPii([line(0, "2024-06-01", "NT$1,200", "第", "3", "頁", "12:30")])).toEqual([]);
});

test("重疊一半以上才算同一個框", () => {
  expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 10, h: 10 })).toBe(true);
  expect(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 8, y: 8, w: 10, h: 10 })).toBe(false);
});

import { expect, test } from "@playwright/test";
import { calver } from "../../src/core/version.ts";

test("版本號是 commit 在台灣時間的日期", () => {
  // 2026-10-17 11:57:08 UTC，台灣時間同一天晚上
  expect(calver(Date.UTC(2026, 9, 17, 11, 57, 8) / 1000)).toBe("2026.10.17");
  // UTC 前一天晚上 16:30 之後，台灣已經是隔天
  expect(calver(Date.UTC(2026, 9, 16, 16, 30) / 1000)).toBe("2026.10.17");
  expect(calver(Date.UTC(2026, 0, 5, 3) / 1000)).toBe("2026.01.05");
});

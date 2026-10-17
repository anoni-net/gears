import { expect, test } from "@playwright/test";
import { calver } from "../../src/core/version.ts";

test("版本號是 commit 在台灣時間的日期與時間，寫到分鐘", () => {
  // 2026-10-17 11:57:08 UTC 是台灣時間晚上 7 點 57 分
  expect(calver(Date.UTC(2026, 9, 17, 11, 57, 8) / 1000)).toBe("2026.10.17 19:57");
  // UTC 前一天晚上 16:30 之後，台灣已經是隔天
  expect(calver(Date.UTC(2026, 9, 16, 16, 30) / 1000)).toBe("2026.10.17 00:30");
  expect(calver(Date.UTC(2026, 0, 5, 3, 4) / 1000)).toBe("2026.01.05 11:04");
  // 同一天合併兩次，版本號不同
  expect(calver(Date.UTC(2026, 9, 17, 4) / 1000)).not.toBe(calver(Date.UTC(2026, 9, 17, 6) / 1000));
});

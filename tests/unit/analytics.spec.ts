import { expect, test } from "@playwright/test";
import models from "../../src/tools/transcribe/models.json" with { type: "json" };
import { toolIds } from "../../src/tools/index.ts";
import { EVENTS, coarseScreen, fileKind, referrerHost, scrub } from "../../src/ui/analytics.ts";
import { TASKS } from "../../src/ui/tasks.ts";

test("只送白名單裡的事件、欄位與值", () => {
  expect(scrub("tool-done", { tool: "strip-metadata" })).toEqual({ tool: "strip-metadata" });
  expect(scrub("tool-fail", { tool: "pdf-pages", reason: "encrypted" })).toEqual({ tool: "pdf-pages", reason: "encrypted" });
  // 不在清單上的事件、多一個欄位、少一個欄位、不在清單上的值，整筆都不送
  expect(scrub("file-name", { name: "IMG_0001.jpg" })).toBeNull();
  expect(scrub("tool-done", { tool: "strip-metadata", name: "IMG_0001.jpg" })).toBeNull();
  expect(scrub("tool-fail", { tool: "pdf-pages" })).toBeNull();
  expect(scrub("tool-done", { tool: "IMG_0001.jpg" })).toBeNull();
  expect(scrub("save", { how: "https://example.com/" })).toBeNull();
});

test("每個工具、任務與模型都在清單上", () => {
  expect(EVENTS["tool-done"]!.tool).toEqual(toolIds);
  expect(EVENTS.task!.task).toEqual(TASKS.map((task) => task.id));
  expect(EVENTS.transcribe!.model).toEqual(Object.keys(models));
});

test("檔案只記大類", () => {
  expect(fileKind("heic")).toBe("image");
  expect(fileKind("docx")).toBe("document");
  expect(fileKind("pdf")).toBe("pdf");
  expect(fileKind("mov")).toBe("media");
  expect(fileKind("gz")).toBe("archive");
  expect(fileKind("eml")).toBe("email");
  expect(fileKind("age")).toBe("other");
  expect(fileKind("unknown")).toBe("other");
});

test("螢幕尺寸取到百位數，referrer 只留網域", () => {
  expect(coarseScreen(390, 844)).toBe("300x800");
  expect(coarseScreen(1512, 982)).toBe("1500x900");
  expect(coarseScreen(80, 60)).toBe("100x100");
  expect(referrerHost("https://anoni.net/docs/tools/metadata/?q=1#a", "example.org")).toBe("https://anoni.net");
  expect(referrerHost("https://anoni.net/gears/", "anoni.net")).toBe("");
  expect(referrerHost("", "anoni.net")).toBe("");
});

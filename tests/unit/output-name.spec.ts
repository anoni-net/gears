import { expect, test } from "@playwright/test";
import type { Format } from "../../src/core/bytes.ts";
import type { TrayFile } from "../../src/core/tray.ts";
import { outputName } from "../../src/ui/output-name.ts";

let id = 1;
function file(name: string, ...formats: [string | null, Format][]): TrayFile {
  const blob = new Blob(["x"]);
  const versions = formats.map(([tool, format]) => ({ id: id++, tool: tool as never, blob, format, findings: [], large: false }));
  return { id: id++, name, addedAt: 0, versions };
}

test("加密檔留著原本的副檔名，解密之後才認得出是什麼檔案", () => {
  expect(outputName(file("名單.csv", [null, "unknown"], ["encrypt", "age"]), 0)).toBe("gears-1.csv.age");
  expect(outputName(file("report.pdf", [null, "pdf"], ["encrypt", "age"]), 1)).toBe("gears-2.pdf.age");
  expect(outputName(file("IMG_0001.JPEG", [null, "jpeg"], ["encrypt", "age"]), 0)).toBe("gears-1.jpg.age");
});

test("解密時拿掉 .age，用裡面的副檔名", () => {
  expect(outputName(file("gears-1.csv.age", [null, "age"], ["decrypt", "unknown"]), 0)).toBe("gears-1.csv");
  expect(outputName(file("名單.csv", [null, "unknown"], ["encrypt", "age"], ["decrypt", "unknown"]), 0)).toBe("gears-1.csv");
  // 舊版只寫 .age，看不出原本的格式
  expect(outputName(file("gears-1.age", [null, "age"], ["decrypt", "unknown"]), 0)).toBe("gears-1.bin");
});

test("加入時就是加密檔，名稱裡有原本的副檔名才留著", () => {
  expect(outputName(file("gears-3.txt.age", [null, "age"]), 0)).toBe("gears-1.txt.age");
  expect(outputName(file("secret.age", [null, "age"]), 0)).toBe("gears-1.age");
});

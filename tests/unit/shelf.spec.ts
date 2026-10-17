import { expect, test } from "@playwright/test";
import type { Format } from "../../src/core/bytes.ts";
import type { Finding } from "../../src/core/tool.ts";
import type { Intent, TrayFile } from "../../src/core/tray.ts";
import { type Signals, buildShelf } from "../../src/ui/shelf.ts";

let id = 1;
function file(name: string, format: Format, findings: Finding["code"][] = [], intent?: Intent, extra: { tools?: string[] } = {}): TrayFile {
  const blob = new Blob(["x"]);
  const versions = [{ id: id++, tool: null, blob, format, findings: findings.map((code) => ({ code })), large: false }];
  for (const tool of extra.tools ?? []) versions.push({ id: id++, tool: tool as never, blob, format, findings: [], large: false });
  return { id: id++, name, addedAt: 0, versions, ...(intent ? { intent } : {}) };
}

const shelf = (f: TrayFile, opts: { others?: TrayFile[]; preferred?: string; signals?: Signals } = {}) =>
  buildShelf({ file: f, others: opts.others ?? [f], preferred: opts.preferred, signals: opts.signals ?? {} });
const ids = (groups: ReturnType<typeof buildShelf>) => groups.map((g) => `${g.id}: ${g.entries.map((e) => `${e.id}${e.reason ? `(${e.reason.key})` : ""}`).join(" ")}`);

test("手機照片：照桌面的三組排列，加密在安全地傳送，建議清除中繼資料與縮成常見尺寸", () => {
  expect(ids(shelf(file("IMG.jpg", "jpeg", ["location", "device", "datetime"])))).toEqual([
    "handover: strip-metadata(strip) blend(blend) redact print-dots",
    "send: encrypt",
    "check: verify",
  ]);
  const strip = shelf(file("IMG.jpg", "jpeg", ["location", "device", "datetime"]))[0]!.entries[0]!;
  expect(strip.reason).toEqual({ key: "strip", findings: ["location", "device"] });
});

test("從檢查收到的任務加入：檢查收到的排在前面，建議查證、不建議清除中繼資料", () => {
  const groups = shelf(file("IMG.jpg", "jpeg", ["location", "device"], "check"));
  expect(ids(groups)).toEqual(["check: verify(verify-clues)", "handover: strip-metadata blend redact print-dots", "send: encrypt"]);
  // 清除中繼資料仍然可以按，只是不建議
  expect(groups[1]!.entries[0]).toMatchObject({ id: "strip-metadata", actionable: true });
  expect(groups[1]!.entries[0]!.reason).toBeUndefined();
});

test("從工具的網址進來時，那個工具與它那一組排在最前面", () => {
  expect(ids(shelf(file("IMG.jpg", "jpeg", ["location"]), { preferred: "redact" }))[0]).toBe("handover: redact strip-metadata(strip) blend print-dots");
});

test("收到的文件：打開時會連線就建議開啟前檢查，有巨集的文件即使沒有訊號也建議", () => {
  expect(ids(shelf(file("a.docx", "docx", ["owner"]), { signals: { docCheck: { connect: 3, code: 0 } } }))).toEqual([
    "handover: strip-metadata(strip)",
    "send: encrypt",
    "check: doc-check(doc-connect) verify",
  ]);
  expect(ids(shelf(file("a.docm", "docm")))).toEqual(["check: doc-check(doc-code) verify", "send: encrypt"]);
});

test("PDF 有舊版本：檢查收到的時候建議查證", () => {
  const groups = shelf(file("a.pdf", "pdf", ["datetime"], "check"), { signals: { pdfRevisions: 2, docCheck: { connect: 0, code: 0 } } });
  expect(groups[0]!.entries[0]).toMatchObject({ id: "verify", reason: { key: "verify-revisions", n: 2 } });
});

test("信件：信件檢查排在最前面", () => {
  expect(ids(shelf(file("mail.eml", "eml")))).toEqual(["check: email-check(email) verify", "send: encrypt"]);
});

test("下載的檔案與簽章檔：兩邊都建議下載的軟體驗證", () => {
  const exe = file("tor-browser.exe", "unknown");
  const sig = file("tor-browser.exe.asc", "unknown");
  expect(ids(shelf(exe, { others: [exe, sig] }))).toEqual(["send: encrypt", "check: software-verify(signature-pair) verify"]);
  expect(ids(shelf(sig, { others: [exe, sig], signals: { signature: true } }))).toEqual(["check: software-verify(signature-file) verify", "send: encrypt"]);
  // 一般的 zip 沒有簽章檔時不列
  expect(shelf(file("a.zip", "zip")).flatMap((g) => g.entries.map((e) => e.id))).not.toContain("software-verify");
});

test("最多兩個建議；處理過的不再建議", () => {
  const heic = shelf(file("IMG.heic", "heic", ["location", "device"]));
  expect(heic.flatMap((g) => g.entries.filter((e) => e.reason).map((e) => e.id))).toEqual(["strip-metadata", "heic-to-jpeg"]);
  const blended = shelf(file("IMG.jpg", "jpeg", ["device"], undefined, { tools: ["strip-metadata", "blend"] }));
  expect(blended.flatMap((g) => g.entries.filter((e) => e.reason).map((e) => e.id))).toEqual([]);
});

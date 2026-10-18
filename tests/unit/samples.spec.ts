import { expect, test } from "@playwright/test";
import { sniff } from "../../src/core/bytes.ts";
import { phishingEmail, revisedPdf, trackedDocx } from "../../src/tools/samples/files.ts";
import { parseEmail } from "../../src/tools/email/parse.ts";

// 範例頁的檔案（src/tools/samples/files.ts）放進暫存區時，要被認成正確的格式，
// 檔案畫面才會建議對的工具。從範例頁直接打開工具時不經過這一步，瀏覽器測試抓不到
test("範例檔案認得出格式", async () => {
  expect(sniff(await trackedDocx())).toBe("docx");
  expect(sniff(await revisedPdf())).toBe("pdf");
  expect(sniff(phishingEmail())).toBe("eml");
});

test("釣魚信的中文標頭折行之後解得回來", () => {
  const msg = parseEmail(phishingEmail());
  expect(msg.subject).toBe("【重要】您的帳戶已暫停使用，請立即驗證");
  expect(msg.from?.name).toBe("安心銀行 service@anxin-bank.example");
  expect(msg.attachments.map((a) => a.name)).toEqual(["帳戶驗證.html"]);
});

import { test as base, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// 每個測試都記下頁面發出的請求與主控台錯誤。CSP 擋下東西時會在主控台留下錯誤，
// 對外連線則會出現在請求清單裡，測試結束時兩者都必須是空的。
export interface Guard {
  requests: string[];
  errors: string[];
}

// 已知、不代表問題的主控台錯誤：
// - Firefox 在 WebRTC 連不上時自己印的建議（面對面傳送不設 STUN，連不上時畫面上另有說明）
// - 查證驗證 CAWG 身分聲明時，c2pa-rs 會連線取得簽發者的 did:web 金鑰（/.well-known/did.json），
//   設定關不掉（c2pa-rs issue #1645），CSP 擋下是預期的結果。Firefox 與 WebKit 會在主控台留下紀錄，
//   Chromium 不會。只放過這一個路徑，其他被 connect-src 擋下的連線照樣算錯誤
const DID_WEB = /\/\.well-known\/did\.json\b.*connect-src|connect-src\)? at https:\/\/[^ ]+\/\.well-known\/did\.json /;
const BENIGN = [/WebRTC: ICE failed, add a STUN server/, DID_WEB];

// 錄 trace 時，Playwright 在 Chromium 會從頁面讀 blob: 的圖片做快照，被 connect-src 擋下。
// CI 只在重試時錄 trace（playwright.config.ts），重試時才忽略這一種，第一次執行照樣嚴格檢查
const TRACING = /^Connecting to 'blob:[^']+' violates the following Content Security Policy directive: "connect-src /;

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, baseURL }, use, testInfo) => {
      const guard: Guard = { requests: [], errors: [] };
      const benign = testInfo.retry > 0 ? [...BENIGN, TRACING] : BENIGN;
      const origin = new URL(baseURL!).origin;
      page.on("request", (r) => {
        const url = r.url();
        if (!url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:")) guard.requests.push(url);
      });
      page.on("console", (m) => {
        if (m.type() === "error" && !benign.some((re) => re.test(m.text()))) guard.errors.push(m.text());
      });
      page.on("pageerror", (e) => guard.errors.push(e.message));
      await use(guard);
      expect(guard.requests, "對外連線").toEqual([]);
      expect(guard.errors, "主控台錯誤").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function downloadFrom(page: Page, click: () => Promise<void>): Promise<{ name: string; data: Uint8Array }> {
  const [file] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: file.suggestedFilename(), data: new Uint8Array(await readFile((await file.path())!)) };
}

import { test as base, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// 每個測試都記下頁面發出的請求與主控台錯誤。CSP 擋下東西時會在主控台留下錯誤，
// 對外連線則會出現在請求清單裡，測試結束時兩者都必須是空的。
export interface Guard {
  requests: string[];
  errors: string[];
}

// 已知、不代表問題的主控台錯誤：
// - WebAssembly 寫到標準錯誤輸出的訊息，瀏覽器一律當成 console.error。這是正常的執行紀錄：
//   Tesseract 讀只含 LSTM 的語言資料時，舊引擎的參數找不到
// - Firefox 在 WebRTC 連不上時自己印的建議（面對面傳送不設 STUN，連不上時畫面上另有說明）
const BENIGN = [/^Warning: Parameter not found: /, /WebRTC: ICE failed, add a STUN server/];

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

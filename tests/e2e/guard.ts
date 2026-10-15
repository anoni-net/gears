import { test as base, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// 每個測試都記下頁面發出的請求與主控台錯誤。CSP 擋下東西時會在主控台留下錯誤，
// 對外連線則會出現在請求清單裡，測試結束時兩者都必須是空的。
export interface Guard {
  requests: string[];
  errors: string[];
}

// WebAssembly 寫到標準錯誤輸出的訊息，瀏覽器一律當成 console.error。這幾種是正常的執行紀錄：
// Tesseract 讀只含 LSTM 的語言資料時，舊引擎的參數找不到；TensorFlow Lite 啟動 CPU 加速
const BENIGN = [/^Warning: Parameter not found: /, /^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/];

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, baseURL }, use) => {
      const guard: Guard = { requests: [], errors: [] };
      const origin = new URL(baseURL!).origin;
      page.on("request", (r) => {
        const url = r.url();
        if (!url.startsWith(origin) && !url.startsWith("blob:") && !url.startsWith("data:")) guard.requests.push(url);
      });
      page.on("console", (m) => {
        if (m.type() === "error" && !BENIGN.some((re) => re.test(m.text()))) guard.errors.push(m.text());
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

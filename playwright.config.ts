import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const BASE = `http://localhost:${PORT}/gears/`;

// unit 在 Node 裡測純邏輯，其他四組在三種瀏覽器核心上測正式建置的產物，
// CSP 也一起生效。iPhone 那組用 WebKit 加上手機的畫面大小與觸控。
export default defineConfig({
  fullyParallel: true,
  globalSetup: "./tests/global-setup.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // expect 的等待上限從預設的 5 秒放寬到 10 秒：工具的程式用到時才載入，整套測試同時執行、
  // 機器很忙時（CI 的 iPhone 與 WebKit 尤其慢）5 秒偶爾不夠。真的卡住的錯誤一樣會失敗
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  // service worker 會接手頁面的請求，page.route 攔不到（165 清單的測試要攔截）。
  // 預設擋掉，離線使用的測試（tests/e2e/offline.spec.ts）自己打開
  // CI 在重試時錄 trace（每一步的畫面、DOM 與事件），失敗時截圖，偶發的失敗才看得到當下的狀況。
  // 跟 test-results/ 一起上傳成 artifact，用 npx playwright show-trace 打開。不每次都錄：錄 trace 時
  // Chromium 會從頁面讀 blob: 的圖片，被 CSP 擋下，有圖片的測試都會因為主控台錯誤失敗（tests/e2e/guard.ts）
  use: {
    baseURL: BASE,
    serviceWorkers: "block",
    // 瀏覽器的語言跟正體中文的頁面一致，不出現換語系的建議（src/ui/LocaleHint.tsx），測試換語系建議的另外指定
    locale: "zh-TW",
    trace: process.env.CI ? "on-first-retry" : "off",
    screenshot: process.env.CI ? "only-on-failure" : "off",
  },
  webServer: [
    {
      command: "npm run build && npm run preview",
      url: BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // 遠端傳送的轉送服務，預覽伺服器把 /gears/relay/ 轉過來（vite.config.ts 的 preview.proxy）。
    // 用打包好的檔案，跟正式環境相同。所有測試都從本機開房，開房次數的上限放寬
    {
      command: "npm run build:server && node dist-server/relay.mjs",
      port: 8791,
      // RELAY_TEST_ICE=all：不發 TURN、允許區網的位址，遠端傳送的資料通道在同一台機器上也打得開
      env: { RELAY_PORT: "8791", RELAY_OPENS_PER_CLIENT: "100000", RELAY_TEST_ICE: "all" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "unit", testDir: "tests/unit" },
    { name: "chromium", testDir: "tests/e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", testDir: "tests/e2e", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", testDir: "tests/e2e", use: { ...devices["Desktop Firefox"] } },
    { name: "iphone", testDir: "tests/e2e", use: { ...devices["iPhone 15"] } },
  ],
});

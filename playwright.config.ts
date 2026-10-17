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
    trace: process.env.CI ? "on-first-retry" : "off",
    screenshot: process.env.CI ? "only-on-failure" : "off",
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "unit", testDir: "tests/unit" },
    { name: "chromium", testDir: "tests/e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", testDir: "tests/e2e", use: { ...devices["Desktop Safari"] } },
    // 面對面傳送的測試在同一個瀏覽器開兩個分頁互連。GitHub 的機器沒有 mDNS 解析，兩邊都只交出
    // mDNS 名稱就連不上；Chromium 與 WebKit 靠相機權限交出區網位址（見 src/ui/NearbyTool.tsx 的
    // openCamera），Firefox 的假相機不會，只好關掉位址隱藏。只影響 WebRTC 的候選
    {
      name: "firefox",
      testDir: "tests/e2e",
      use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: { "media.peerconnection.ice.obfuscate_host_addresses": false } } },
    },
    { name: "iphone", testDir: "tests/e2e", use: { ...devices["iPhone 15"] } },
  ],
});

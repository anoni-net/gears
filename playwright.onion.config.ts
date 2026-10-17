import { defineConfig, devices } from "@playwright/test";

// onion 版（GEARS_TARGET=onion）的冒煙測試：網站放在根目錄，載入得起來、工具打得開、不連到
// 其他主機。功能跟 clearnet 版是同一份程式，完整的測試在 playwright.config.ts。
// npm run test:onion
const PORT = 4175;
const BASE = `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: "tests/onion",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: BASE, serviceWorkers: "block", ...devices["Desktop Chrome"] },
  webServer: {
    command: `GEARS_TARGET=onion npm run build && node scripts/check-site.mjs dist-onion / --onion && GEARS_TARGET=onion npx vite preview --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

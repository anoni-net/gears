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
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: BASE },
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
    { name: "firefox", testDir: "tests/e2e", use: { ...devices["Desktop Firefox"] } },
    { name: "iphone", testDir: "tests/e2e", use: { ...devices["iPhone 15"] } },
  ],
});

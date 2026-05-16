// Playwright config — Phase 89.14
// Smoke test สำหรับ Boonsook POS V5 PWA
// Run: npx playwright test
//
// Local server: ใช้ python3 http.server (มากับ Ubuntu/macOS, ไม่ต้องลง deps)

import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,         // PWA — serial เพื่อ deterministic
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // ใช้ python3 http.server แทน npm package เพื่อ keep zero runtime-dep
    command: `python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});

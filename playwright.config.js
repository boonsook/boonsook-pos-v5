// Playwright config — Phase 89.14, webServer cross-platform from Phase 90.5
// Smoke test สำหรับ Boonsook POS V5 PWA
// Run: npx playwright test
//
// Local server: scripts/static-server.js (Node built-ins only, zero npm deps,
// works on Windows/macOS/Linux). Replaces `python3 -m http.server` which
// failed on Windows machines that only have the Microsoft Store python stub.

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
    // Node-based static server (zero new npm deps). See scripts/static-server.js.
    // Cross-platform: works on Windows / macOS / Linux without Python.
    command: `node scripts/static-server.js ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});

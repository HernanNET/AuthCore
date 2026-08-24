import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for AuthCore — production mailbox isolation test.
 * Runs ONLY test 14 against a DEV-mode server on port 4322 (AUTH_ENV=development).
 * The test-mailbox endpoint must return 404 in non-test mode.
 */
export default defineConfig({
  testDir: "./tests/e2e-production",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4322",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx astro dev --port 4322",
    port: 4322,
    timeout: 60_000,
    reuseExistingServer: false,
    env: { AUTH_ENV: "development", ASTRO_DEV_BACKGROUND: "0" },
  },
});

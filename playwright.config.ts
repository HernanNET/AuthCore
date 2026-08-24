import { defineConfig, devices } from "@playwright/test";

const testPort = Number(process.env.AUTHCORE_TEST_PORT ?? 4321);
const testBaseURL = `http://localhost:${testPort}`;

/**
 * Playwright config for AuthCore Phases 1–19 — main test suite.
 * Runs against the isolated TEST-mode server/database on port 4321.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: testBaseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx astro dev --force --port ${testPort}`,
    port: testPort,
    timeout: 60_000,
    reuseExistingServer: process.env.AUTHCORE_REUSE_SERVER === "1",
    env: {
      AUTH_ENV: "test",
      ASTRO_DEV_BACKGROUND: "0",
      BETTER_AUTH_URL: testBaseURL,
      AUTHCORE_TEST_URL: testBaseURL,
    },
  },
});

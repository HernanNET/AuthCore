import { test, expect, type APIRequestContext } from "@playwright/test";
import { cleanupTestUsers, closeDb, countAllRateLimits } from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";
const STRICT = "x-authcore-test-rate-limit";

function headers(ip: string) {
  return { [STRICT]: "strict", "x-authcore-test-client-ip": ip };
}

async function attemptLogin(request: APIRequestContext, ip: string) {
  return request.post(`${BASE}/api/auth/sign-in/email`, {
    headers: headers(ip),
    data: {
      email: `missing-${ip.replaceAll(".", "-")}@example.test`,
      password: "Sup3rSecret!pass",
      rememberMe: true,
    },
  });
}

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

test("1 — repeated password attempts receive 429 and Retry-After", async ({ request }) => {
  const ip = "198.51.100.13";
  for (let i = 0; i < 5; i += 1) {
    expect((await attemptLogin(request, ip)).status()).not.toBe(429);
  }
  const blocked = await attemptLogin(request, ip);
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["x-retry-after"])).toBeGreaterThan(0);
  expect(await countAllRateLimits()).toBeGreaterThan(0);
});

test("2 — one blocked address does not block a different address", async ({ request }) => {
  for (let i = 0; i < 6; i += 1) await attemptLogin(request, "198.51.100.21");
  expect((await attemptLogin(request, "198.51.100.21")).status()).toBe(429);
  expect((await attemptLogin(request, "198.51.100.22")).status()).not.toBe(429);
});

test("3 — access recovers after the rate-limit window", async ({ request }) => {
  const ip = "198.51.100.31";
  for (let i = 0; i < 6; i += 1) await attemptLogin(request, ip);
  expect((await attemptLogin(request, ip)).status()).toBe(429);
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  expect((await attemptLogin(request, ip)).status()).not.toBe(429);
});

test("4 — password-reset requests are throttled without account enumeration", async ({ request }) => {
  const options = {
    headers: headers("198.51.100.41"),
    data: { email: "unknown-rate-limit@example.test", redirectTo: "/reset-password" },
  };
  for (let i = 0; i < 3; i += 1) {
    expect((await request.post(`${BASE}/api/auth/request-password-reset`, options)).status()).not.toBe(429);
  }
  const blocked = await request.post(`${BASE}/api/auth/request-password-reset`, options);
  expect(blocked.status()).toBe(429);
  expect((await blocked.text()).toLowerCase()).not.toContain("unknown-rate-limit@example.test");
});

test("5 — registration attempts are throttled before unlimited account creation", async ({ request }) => {
  const options = {
    headers: headers("198.51.100.51"),
    data: { name: "Rate Test", email: "invalid", password: "Sup3rSecret!pass" },
  };
  for (let i = 0; i < 5; i += 1) {
    expect((await request.post(`${BASE}/api/auth/sign-up/email`, options)).status()).not.toBe(429);
  }
  expect((await request.post(`${BASE}/api/auth/sign-up/email`, options)).status()).toBe(429);
});

test("6 — login UI shows a safe throttling message", async ({ page, request }) => {
  const ip = "198.51.100.61";
  for (let i = 0; i < 5; i += 1) await attemptLogin(request, ip);
  await page.setExtraHTTPHeaders(headers(ip));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "missing-198-51-100-61@example.test");
  await page.fill("#password", "Sup3rSecret!pass");
  await page.click("#login-button");
  await expect(page.locator("#error-message")).toHaveText(
    "Too many sign-in attempts. Please wait before trying again.",
  );
});

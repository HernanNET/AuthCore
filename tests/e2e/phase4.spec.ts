import { test, expect } from "@playwright/test";
import {
  findUserByEmail,
  countSessionsForUser,
  countAllSessions,
  cleanupTestUsers,
  deleteUserByEmail,
  closeDb,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import {
  registerAndVerifyUser,
  loginUser,
  DEFAULT_PASSWORD,
} from "../helpers/auth-flow";

const BASE = "http://localhost:4321";

// ─── Global setup/teardown ──────────────────────────────────────────────────

test.beforeAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
});

test.afterAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
  await closeDb();
});

// ─── Helper: get session cookies from context ───────────────────────────────

function getSessionCookies(cookies: Array<{ name: string }>): number {
  return cookies.filter(
    (c) => c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth"),
  ).length;
}

// ─── Helper: full login flow, returns email ─────────────────────────────────

async function loginVerifiedUser(page: import("@playwright/test").Page, name: string): Promise<string> {
  const email = await registerAndVerifyUser(page, name);
  await loginUser(page, email, DEFAULT_PASSWORD);
  await page.waitForURL(/\/account/);
  return email;
}

// ─── TEST 1: sign out button visible ────────────────────────────────────────

test("1 — sign out button visible when authenticated", async ({ page }) => {
  const email = await loginVerifiedUser(page, "Signout Button User");

  await expect(page.locator("#user-name")).toContainText("Signout Button User");
  await expect(page.locator("#signout-button")).toBeVisible();

  await deleteUserByEmail(email);
});

// ─── TEST 2: successful logout ───────────────────────────────────────────────

test("2 — successful logout redirects to login", async ({ page }) => {
  const email = await loginVerifiedUser(page, "Logout Success User");

  // Click sign out
  await page.click("#signout-button");

  // Should redirect to /login
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Authenticated content disappears
  await expect(page.locator("#user-name")).not.toBeVisible();

  await deleteUserByEmail(email);
});

// ─── TEST 3: session invalidated in PostgreSQL ───────────────────────────────

test("3 — current session invalidated in PostgreSQL after logout", async ({ page }) => {
  const email = await loginVerifiedUser(page, "DB Invalidation User");

  const user = await findUserByEmail(email);
  const sessionsBefore = await countSessionsForUser(user.id);
  expect(sessionsBefore).toBeGreaterThanOrEqual(1);

  // Logout through actual app flow
  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Query PostgreSQL — session count should decrease
  const sessionsAfter = await countSessionsForUser(user.id);
  expect(sessionsAfter).toBeLessThan(sessionsBefore);

  await deleteUserByEmail(email);
});

// ─── TEST 4: auth cookie invalidated ─────────────────────────────────────────

test("4 — auth cookie invalidated after logout", async ({ page, context }) => {
  const email = await loginVerifiedUser(page, "Cookie Invalidation User");

  // Before logout: session cookie exists
  const cookiesBefore = await context.cookies();
  expect(getSessionCookies(cookiesBefore)).toBeGreaterThanOrEqual(1);

  // Logout
  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // After logout: no usable authenticated cookie
  const cookiesAfter = await context.cookies();
  const authCookies = cookiesAfter.filter(
    (c) => c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth"),
  );
  // Cookie is either absent or cleared (empty value)
  const usableAuthCookies = authCookies.filter((c) => c.value.length > 0);
  expect(usableAuthCookies.length).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 5: protected route denied after logout ─────────────────────────────

test("5 — protected route denied after logout", async ({ page }) => {
  const email = await loginVerifiedUser(page, "Protected Deny User");

  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Navigate manually to /account
  await page.goto(`${BASE}/account`);

  // Must redirect to login
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  await deleteUserByEmail(email);
});

// ─── TEST 6: refresh cannot restore session ──────────────────────────────────

test("6 — refresh cannot restore session after logout", async ({ page }) => {
  const email = await loginVerifiedUser(page, "Refresh Logout User");

  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Refresh the login page
  await page.reload();

  // Then visit /account
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  await deleteUserByEmail(email);
});

// ─── TEST 7: two browser contexts, current session only ──────────────────────

test("7 — logout in Browser A does not log out Browser B", async ({ browser }) => {
  // Create and verify user in a setup context
  const setupContext = await browser.newContext();
  const setupPage = await setupContext.newPage();
  const email = await registerAndVerifyUser(setupPage, "Two Browser User");
  await setupContext.close();

  // Browser A: login
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await loginUser(pageA, email, DEFAULT_PASSWORD);
  await pageA.waitForURL(/\/account/);
  await expect(pageA.locator("#user-name")).toBeVisible();

  // Browser B: login same credentials
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await loginUser(pageB, email, DEFAULT_PASSWORD);
  await pageB.waitForURL(/\/account/);
  await expect(pageB.locator("#user-name")).toBeVisible();

  // Both can access /account
  const user = await findUserByEmail(email);
  const sessionsBoth = await countSessionsForUser(user.id);
  expect(sessionsBoth).toBeGreaterThanOrEqual(2);

  // Logout Browser A
  await pageA.click("#signout-button");
  await pageA.waitForURL(/\/login/, { timeout: 10_000 });

  // Browser A: denied
  await pageA.goto(`${BASE}/account`);
  await pageA.waitForURL(/\/login/);
  await expect(pageA.locator("#user-name")).not.toBeVisible();

  // Browser B: still authenticated
  await pageB.goto(`${BASE}/account`);
  await expect(pageB.locator("#user-name")).toContainText("Two Browser User");
  await expect(pageB.locator("#user-email")).toContainText(email);

  // Database: one active session remains for Browser B
  const sessionsAfter = await countSessionsForUser(user.id);
  expect(sessionsAfter).toBeGreaterThanOrEqual(1);

  await contextA.close();
  await contextB.close();
  await deleteUserByEmail(email);
});

// ─── TEST 8: anonymous logout ────────────────────────────────────────────────

test("8 — anonymous logout is safe", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Attempt logout via API without any session
  const res = await fetch(`${BASE}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  // Should not crash — safe response (200 or 4xx, not 5xx)
  expect(res.status).toBeLessThan(500);

  // /account denied
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  // No sessions in DB
  const sessions = await countAllSessions();
  expect(sessions).toBe(0);

  await context.close();
});

// ─── TEST 9: repeated logout ─────────────────────────────────────────────────

test("9 — repeated logout is stable", async ({ page }) => {
  const email = await loginVerifiedUser(page, "Repeated Logout User");

  // First logout
  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Attempt logout again via API (no UI button on /login)
  const res = await fetch(`${BASE}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  // Should be safe — no crash, no session created
  expect(res.status).toBeLessThan(500);

  // Still unauthenticated
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  // No sessions in DB
  const sessions = await countAllSessions();
  expect(sessions).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 10: rememberMe=true logout ─────────────────────────────────────────

test("10 — rememberMe=true logout works", async ({ page, context }) => {
  const email = await registerAndVerifyUser(page, "Remember True Logout");

  // Login with remember me checked
  await loginUser(page, email, DEFAULT_PASSWORD, true);
  await page.waitForURL(/\/account/);

  // Confirm cookie exists
  const cookiesBefore = await context.cookies();
  expect(getSessionCookies(cookiesBefore)).toBeGreaterThanOrEqual(1);

  // Logout
  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Cookie unusable
  const cookiesAfter = await context.cookies();
  const usableAuthCookies = cookiesAfter.filter(
    (c) => (c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth")) && c.value.length > 0,
  );
  expect(usableAuthCookies.length).toBe(0);

  // /account denied
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  await deleteUserByEmail(email);
});

// ─── TEST 11: rememberMe=false logout ────────────────────────────────────────

test("11 — rememberMe=false logout works", async ({ page, context }) => {
  const email = await registerAndVerifyUser(page, "Remember False Logout");

  // Login with remember me unchecked
  await loginUser(page, email, DEFAULT_PASSWORD, false);
  await page.waitForURL(/\/account/);

  // Confirm cookie exists
  const cookiesBefore = await context.cookies();
  expect(getSessionCookies(cookiesBefore)).toBeGreaterThanOrEqual(1);

  // Logout
  await page.click("#signout-button");
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // Cookie unusable
  const cookiesAfter = await context.cookies();
  const usableAuthCookies = cookiesAfter.filter(
    (c) => (c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth")) && c.value.length > 0,
  );
  expect(usableAuthCookies.length).toBe(0);

  // /account denied
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  await deleteUserByEmail(email);
});

// ─── TEST 12: malformed logout request ───────────────────────────────────────

test("12 — malformed logout request rejected safely", async () => {
  // Send non-JSON body to sign-out endpoint
  const res = await fetch(`${BASE}/api/auth/sign-out`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "not-json",
  });

  // Must be rejected safely (4xx, not 5xx)
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);

  // No stack trace exposed
  const text = await res.text();
  expect(text.toLowerCase()).not.toContain("stack");
  expect(text.toLowerCase()).not.toContain("at /");

  // No sessions created
  const sessions = await countAllSessions();
  expect(sessions).toBe(0);
});

import { test, expect } from "@playwright/test";
import { findUserByEmail, countSessionsForUser, countAllUsers, countAllSessions, countAllAccounts, cleanupTestUsers, deleteUserByEmail, closeDb } from "../helpers/db";
import { waitForVerificationEmail, fetchCapturedEmails, clearAllMailbox } from "../helpers/mailbox";

const BASE = "http://localhost:4321";
const PASSWORD = "Sup3rSecret!pass";

/** Generate a unique test email. */
function uniqueEmail(): string {
  return `playwright-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Register via the browser UI. */
async function register(page: import("@playwright/test").Page, name: string, email: string, password: string) {
  await page.goto(`${BASE}/register`);
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.fill("#confirm-password", password);
  await page.click("#register-button");
}

/** Extract the verification URL from the captured mailbox. */
async function getVerificationUrl(email: string): Promise<string> {
  const msg = await waitForVerificationEmail(email);
  return msg.verificationUrl;
}

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

// ─── TEST 1: new user is unverified ─────────────────────────────────────────

test("1 — new user has emailVerified=false", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(user.emailVerified).toBe(false);

  await deleteUserByEmail(email);
});

// ─── TEST 2: verification email generated ───────────────────────────────────

test("2 — verification email generated and captured", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  const messages = await fetchCapturedEmails(email);
  expect(messages.length).toBeGreaterThanOrEqual(1);

  await deleteUserByEmail(email);
});

// ─── TEST 3: correct recipient ──────────────────────────────────────────────

test("3 — correct recipient on captured email", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  const msg = await waitForVerificationEmail(email);
  expect(msg.to).toBe(email);

  await deleteUserByEmail(email);
});

// ─── TEST 4: verification URL exists ────────────────────────────────────────

test("4 — verification URL exists in captured email", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  const url = await getVerificationUrl(email);
  expect(url).toContain("/verify-email");
  expect(url).toContain("token=");

  await deleteUserByEmail(email);
});

// ─── TEST 5: URL contains no sensitive data ─────────────────────────────────

test("5 — verification URL contains no password or secrets", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  const url = await getVerificationUrl(email);
  expect(url).not.toContain(PASSWORD);
  expect(url).not.toContain("DATABASE_URL");
  expect(url).not.toContain("BETTER_AUTH_SECRET");
  expect(url).not.toContain("authcore_dev");
  expect(url).not.toContain("postgres://");

  await deleteUserByEmail(email);
});

// ─── TEST 6-9: browser verification, emailVerified=true, no session ─────────

test("6/7/8/9 — browser verification succeeds, emailVerified=true, no session", async ({ page, context }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  // No session cookie should exist after registration
  const cookiesAfterReg = await context.cookies();
  const sessionCookies = cookiesAfterReg.filter((c) => c.name.includes("session") || c.name.includes("auth"));
  expect(sessionCookies.length).toBe(0);

  const url = await getVerificationUrl(email);

  // Navigate to the native Better Auth verification URL
  await page.goto(url);

  // Should redirect to /verify-email?status=success
  await page.waitForURL(/\/verify-email/);
  await expect(page.locator("#verify-success")).toBeVisible();

  // DB: emailVerified=true
  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(user.emailVerified).toBe(true);

  // DB: session count = 0
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBe(0);

  // No session cookie after verification
  const cookiesAfterVerify = await context.cookies();
  const sessionCookiesAfter = cookiesAfterVerify.filter((c) => c.name.includes("session") || c.name.includes("auth"));
  expect(sessionCookiesAfter.length).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 10: refresh stability ─────────────────────────────────────────────

test("10 — refresh after verification remains stable", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  const url = await getVerificationUrl(email);
  await page.goto(url);
  await page.waitForURL(/\/verify-email/);
  await expect(page.locator("#verify-success")).toBeVisible();

  // Refresh the page
  await page.reload();
  await expect(page.locator("#verify-success")).toBeVisible();

  // User remains verified, no session
  const user = await findUserByEmail(email);
  expect(user.emailVerified).toBe(true);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 11: token replay is safe ──────────────────────────────────────────

test("11 — replayed verification link is safe", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  const url = await getVerificationUrl(email);

  // First verification
  await page.goto(url);
  await page.waitForURL(/\/verify-email/);
  await expect(page.locator("#verify-success")).toBeVisible();

  // Replay the same link
  await page.goto(url);
  // User remains verified, no new session, no escalation
  const user = await findUserByEmail(email);
  expect(user.emailVerified).toBe(true);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 12: invalid token is safe ─────────────────────────────────────────

test("12 — invalid token is safe", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  // Use a random invalid token
  const invalidUrl = `${BASE}/api/auth/verify-email?token=invalidtoken123&callbackURL=${encodeURIComponent("/verify-email?status=success")}`;
  await page.goto(invalidUrl);
  await page.waitForURL(/\/verify-email/);

  // Safe failure UI shown (error state, not success)
  const errorVisible = await page.locator("#verify-error").isVisible().catch(() => false);
  const successVisible = await page.locator("#verify-success").isVisible().catch(() => false);
  expect(errorVisible || !successVisible).toBe(true);

  // User NOT verified, no session
  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(user.emailVerified).toBe(false);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 13: expired token is safe ─────────────────────────────────────────

test("13 — expired token is safe", async ({ page }) => {
  const email = uniqueEmail();
  await register(page, "Phase Two", email, PASSWORD);
  await expect(page.locator("#success-state")).toBeVisible();

  const url = await getVerificationUrl(email);

  // Wait for token to expire (test expiresIn = 2s, wait 4s)
  await page.waitForTimeout(4000);

  // Navigate to the now-expired verification URL
  await page.goto(url);
  await page.waitForURL(/\/verify-email/);

  // Should show error, not success
  const errorVisible = await page.locator("#verify-error").isVisible().catch(() => false);
  const successVisible = await page.locator("#verify-success").isVisible().catch(() => false);
  expect(errorVisible || !successVisible).toBe(true);

  // User NOT verified, no session
  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(user.emailVerified).toBe(false);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 15: cleanup leaves zero users/sessions/emails ─────────────────────

test("15 — cleanup leaves zero test users, sessions, and captured emails", async () => {
  await cleanupTestUsers();
  await clearAllMailbox();

  // Verify zero test users remain
  const users = await countAllUsers();
  expect(users).toBe(0);

  // Verify zero sessions
  const sessions = await countAllSessions();
  expect(sessions).toBe(0);

  // Verify zero accounts
  const accounts = await countAllAccounts();
  expect(accounts).toBe(0);

  // Verify captured emails are cleared
  const messages = await fetchCapturedEmails("playwright-cleanup@example.test");
  expect(messages.length).toBe(0);
});

// Note: Test 14 (production mailbox isolation) runs in a separate Playwright
// config (playwright.config.production.ts) against a dev-mode server on port 4322.

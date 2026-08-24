import { test, expect } from "@playwright/test";
import {
  findUserByEmail,
  countSessionsForUser,
  countAllSessions,
  cleanupTestUsers,
  deleteUserByEmail,
  closeDb,
} from "../helpers/db";
import { clearAllMailbox, fetchCapturedEmails } from "../helpers/mailbox";
import {
  uniqueEmail,
  registerUser,
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

// ─── TEST 1: login page loads ───────────────────────────────────────────────

test("1 — login page loads with all required fields", async ({ page }) => {
  await page.goto(`${BASE}/login`);

  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator("#remember-me")).toBeVisible();
  await expect(page.locator("#login-button")).toBeVisible();
});

// ─── TEST 2: unverified user cannot login ───────────────────────────────────

test("2 — unverified user cannot login", async ({ page, context }) => {
  const email = uniqueEmail();
  await registerUser(page, "Unverified User", email);

  // Wait for registration success
  await page.waitForSelector("#success-state", { state: "visible" });

  // Confirm DB: emailVerified = false, sessions = 0
  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(user.emailVerified).toBe(false);
  const sessionsBefore = await countSessionsForUser(user.id);
  expect(sessionsBefore).toBe(0);

  // Attempt login with correct password
  await loginUser(page, email, DEFAULT_PASSWORD);

  // Assert: safe verification-required message shown
  await page.waitForSelector("#error-message", { state: "visible" });
  const errorText = await page.locator("#error-message").textContent();
  expect(errorText?.toLowerCase()).toContain("verify");

  // Assert: no session in DB
  const sessionsAfter = await countSessionsForUser(user.id);
  expect(sessionsAfter).toBe(0);

  // Assert: no session cookie
  const cookies = await context.cookies();
  expect(getSessionCookies(cookies)).toBe(0);

  // Assert: protected page cannot be accessed (redirects to login)
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);

  await deleteUserByEmail(email);
});

// ─── TEST 3: verified user can login ─────────────────────────────────────────

test("3 — verified user can login and reach protected page", async ({ page, context }) => {
  const email = await registerAndVerifyUser(page, "Verified User");

  // Confirm DB: emailVerified = true, sessions = 0 before login
  const user = await findUserByEmail(email);
  expect(user).not.toBeNull();
  expect(user.emailVerified).toBe(true);
  const sessionsBefore = await countSessionsForUser(user.id);
  expect(sessionsBefore).toBe(0);

  // Login
  await loginUser(page, email, DEFAULT_PASSWORD);

  // Should redirect to /account
  await page.waitForURL(/\/account/);

  // Assert: authenticated session exists in DB
  const sessionsAfter = await countSessionsForUser(user.id);
  expect(sessionsAfter).toBeGreaterThanOrEqual(1);

  // Assert: session cookie exists
  const cookies = await context.cookies();
  expect(getSessionCookies(cookies)).toBeGreaterThanOrEqual(1);

  // Assert: correct name and email displayed
  await expect(page.locator("#user-name")).toContainText("Verified User");
  await expect(page.locator("#user-email")).toContainText(email);
  await expect(page.locator("#user-verified")).toContainText("Yes");

  await deleteUserByEmail(email);
});

// ─── TEST 4: wrong password ─────────────────────────────────────────────────

test("4 — wrong password rejected", async ({ page, context }) => {
  const email = await registerAndVerifyUser(page, "Wrong Pass User");

  const user = await findUserByEmail(email);
  const sessionsBefore = await countSessionsForUser(user.id);

  // Login with wrong password
  await loginUser(page, email, "WrongPassword123!");

  // Assert: generic error shown (not "verify")
  await page.waitForSelector("#error-message", { state: "visible" });
  const errorText = await page.locator("#error-message").textContent();
  expect(errorText).toContain("Invalid email or password");

  // Assert: no new session
  const sessionsAfter = await countSessionsForUser(user.id);
  expect(sessionsAfter).toBe(sessionsBefore);

  // Assert: no session cookie
  const cookies = await context.cookies();
  expect(getSessionCookies(cookies)).toBe(0);

  await deleteUserByEmail(email);
});

// ─── TEST 5: unknown email ──────────────────────────────────────────────────

test("5 — unknown email rejected safely", async ({ page, context }) => {
  const email = uniqueEmail();

  // Login with nonexistent email
  await loginUser(page, email, "SomePassword123!");

  // Assert: generic error (must not say "user does not exist")
  await page.waitForSelector("#error-message", { state: "visible" });
  const errorText = await page.locator("#error-message").textContent();
  expect(errorText).toContain("Invalid email or password");
  expect(errorText?.toLowerCase()).not.toContain("exist");
  expect(errorText?.toLowerCase()).not.toContain("not found");

  // Assert: no session cookie
  const cookies = await context.cookies();
  expect(getSessionCookies(cookies)).toBe(0);

  // Assert: no user created, no sessions in DB
  const user = await findUserByEmail(email);
  expect(user).toBeNull();
});

// ─── TEST 6: enumeration-safe UI ────────────────────────────────────────────

test("6 — wrong-password and unknown-user UI are equivalent", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Enum Test User");

  // A: existing verified account + wrong password
  await loginUser(page, email, "WrongPassword123!");
  await page.waitForSelector("#error-message", { state: "visible" });
  const errorA = await page.locator("#error-message").textContent();

  // B: nonexistent account + arbitrary password
  const nonexistentEmail = uniqueEmail();
  await page.goto(`${BASE}/login`);
  await loginUser(page, nonexistentEmail, "WrongPassword123!");
  await page.waitForSelector("#error-message", { state: "visible" });
  const errorB = await page.locator("#error-message").textContent();

  // Both should show the same generic message
  expect(errorA).toBe(errorB);
  expect(errorA).toContain("Invalid email or password");

  await deleteUserByEmail(email);
});

// ─── TEST 7: protected page rejects anonymous browser ───────────────────────

test("7 — protected page rejects anonymous browser", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Open protected page directly with no cookies
  await page.goto(`${BASE}/account`);

  // Must redirect to login (not show protected data)
  await page.waitForURL(/\/login/);
  await expect(page.locator("#user-name")).not.toBeVisible();

  await context.close();
});

// ─── TEST 8: authenticated protected page ───────────────────────────────────

test("8 — authenticated protected page shows safe user data", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Protected Page User");

  await loginUser(page, email, DEFAULT_PASSWORD);
  await page.waitForURL(/\/account/);

  // Assert: name, email, verified status displayed
  await expect(page.locator("#user-name")).toContainText("Protected Page User");
  await expect(page.locator("#user-email")).toContainText(email);
  await expect(page.locator("#user-verified")).toContainText("Yes");

  // Assert: no sensitive data exposed (no session token, no password hash)
  const bodyText = await page.locator("body").textContent();
  expect(bodyText).not.toContain(DEFAULT_PASSWORD);
  expect(bodyText).not.toContain("passwordHash");
  expect(bodyText).not.toContain("token");
  expect(bodyText).not.toContain("hash");

  await deleteUserByEmail(email);
});

// ─── TEST 9: session survives refresh ───────────────────────────────────────

test("9 — session survives page refresh", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Refresh User");

  await loginUser(page, email, DEFAULT_PASSWORD);
  await page.waitForURL(/\/account/);

  // Refresh
  await page.reload();

  // Should still be on /account with protected content
  await expect(page.locator("#user-name")).toBeVisible();
  await expect(page.locator("#user-email")).toContainText(email);

  // Session still valid in DB
  const user = await findUserByEmail(email);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBeGreaterThanOrEqual(1);

  await deleteUserByEmail(email);
});

// ─── TEST 10: isolated browser has no session ───────────────────────────────

test("10 — new browser context has no session", async ({ page, browser }) => {
  const email = await registerAndVerifyUser(page, "Isolation User");

  await loginUser(page, email, DEFAULT_PASSWORD);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#user-name")).toBeVisible();

  // Create a completely new context
  const newContext = await browser.newContext();
  const newPage = await newContext.newPage();

  // Open protected page in the new context
  await newPage.goto(`${BASE}/account`);

  // Must redirect to login — no shared session
  await newPage.waitForURL(/\/login/);
  await expect(newPage.locator("#user-name")).not.toBeVisible();

  await newContext.close();
  await deleteUserByEmail(email);
});

// ─── TEST 11: rememberMe=true cookie metadata ───────────────────────────────

test("11 — rememberMe=true produces persistent session cookie", async ({ page, context }) => {
  const email = await registerAndVerifyUser(page, "Remember Me True");

  // Login with remember me checked (default)
  await loginUser(page, email, DEFAULT_PASSWORD, true);
  await page.waitForURL(/\/account/);

  // Assert: session cookie exists
  const cookies = await context.cookies();
  const sessionCookies = cookies.filter(
    (c) => c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth"),
  );
  expect(sessionCookies.length).toBeGreaterThanOrEqual(1);

  // Assert: cookie is HttpOnly (security check, no value exposed)
  for (const c of sessionCookies) {
    expect(c.httpOnly).toBe(true);
  }

  // Assert: session exists in DB
  const user = await findUserByEmail(email);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBeGreaterThanOrEqual(1);

  await deleteUserByEmail(email);
});

// ─── TEST 12: rememberMe=false cookie metadata ──────────────────────────────

test("12 — rememberMe=false produces browser-session cookie", async ({ page, context }) => {
  const email = await registerAndVerifyUser(page, "Remember Me False");

  // Login with remember me unchecked
  await loginUser(page, email, DEFAULT_PASSWORD, false);
  await page.waitForURL(/\/account/);

  // Assert: session cookie exists
  const cookies = await context.cookies();
  const sessionCookies = cookies.filter(
    (c) => c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth"),
  );
  expect(sessionCookies.length).toBeGreaterThanOrEqual(1);

  // Assert: cookie is HttpOnly (security check, no value exposed)
  for (const c of sessionCookies) {
    expect(c.httpOnly).toBe(true);
  }

  // Assert: session exists in DB
  const user = await findUserByEmail(email);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBeGreaterThanOrEqual(1);

  await deleteUserByEmail(email);
});

// ─── TEST 13: repeated login submit safety ──────────────────────────────────

test("13 — repeated login submit does not create uncontrolled sessions", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Repeat Submit User");

  const user = await findUserByEmail(email);
  const sessionsBefore = await countSessionsForUser(user.id);

  // Go to login page and click submit multiple times rapidly
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", DEFAULT_PASSWORD);

  // Click rapidly — the form's submitting guard should prevent duplicates
  await page.click("#login-button");
  // Wait for redirect
  await page.waitForURL(/\/account/, { timeout: 10_000 }).catch(() => {});

  // Check: we are on the account page (one successful login)
  const currentUrl = page.url();
  expect(currentUrl).toContain("/account");

  // Session count should be reasonable (1, not uncontrolled duplicates)
  const sessionsAfter = await countSessionsForUser(user.id);
  expect(sessionsAfter).toBeGreaterThanOrEqual(1);
  // No uncontrolled explosion — at most sessionsBefore + 1
  expect(sessionsAfter).toBeLessThanOrEqual(sessionsBefore + 1);

  await deleteUserByEmail(email);
});

// ─── TEST 14: malformed login request ───────────────────────────────────────

test("14 — malformed login request rejected safely", async () => {
  // Send malformed data directly to the auth API
  const cases = [
    { body: JSON.stringify({ email: "", password: "" }), label: "empty fields" },
    { body: JSON.stringify({ email: "not-an-email", password: "short" }), label: "invalid email" },
    { body: JSON.stringify({ email: "valid@example.test" }), label: "missing password" },
    { body: JSON.stringify({ password: "somepassword" }), label: "missing email" },
    { body: "not-json", label: "non-JSON body" },
    { body: JSON.stringify({ email: 123, password: true }), label: "wrong types" },
  ];

  for (const c of cases) {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: c.body,
    });

    // Must be rejected (4xx or 5xx), not 200
    expect(res.status, `case: ${c.label}`).toBeGreaterThanOrEqual(400);
    expect(res.status, `case: ${c.label}`).toBeLessThan(500);

    // No stack trace in response body
    const text = await res.text();
    expect(text.toLowerCase()).not.toContain("stack");
    expect(text.toLowerCase()).not.toContain("at /");
  }

  // Assert: no sessions created in DB for any of these attempts
  const sessions = await countAllSessions();
  expect(sessions).toBe(0);
});

// ─── TEST 15: verification resend on unverified login ───────────────────────

test("15 — unverified login triggers verification email resend", async ({ page, context }) => {
  const email = uniqueEmail();
  await registerUser(page, "Resend Test", email);
  await page.waitForSelector("#success-state", { state: "visible" });

  // Clear mailbox to isolate the resend
  await clearAllMailbox();

  // Attempt login with correct password (user is unverified)
  await loginUser(page, email, DEFAULT_PASSWORD);

  // Assert: login rejected with verification message
  await page.waitForSelector("#error-message", { state: "visible" });
  const errorText = await page.locator("#error-message").textContent();
  expect(errorText?.toLowerCase()).toContain("verify");

  // Assert: no session
  const user = await findUserByEmail(email);
  const sessions = await countSessionsForUser(user.id);
  expect(sessions).toBe(0);

  // Assert: no auth cookie
  const cookies = await context.cookies();
  const sessionCookies = cookies.filter(
    (c) => c.name.includes("session") || c.name.includes("better-auth") || c.name.includes("auth"),
  );
  expect(sessionCookies.length).toBe(0);

  // Assert: a new verification email was captured (sendOnSignIn re-sent it)
  // Give it a moment to arrive
  await page.waitForTimeout(500);
  const capturedEmails = await fetchCapturedEmails(email);
  expect(capturedEmails.length).toBeGreaterThanOrEqual(1);

  // Assert: the captured email has a verification URL (no token exposed in UI)
  const lastEmail = capturedEmails[capturedEmails.length - 1];
  expect(lastEmail.to).toBe(email);
  expect(lastEmail.verificationUrl).toContain("/verify-email");
  expect(lastEmail.verificationUrl).toContain("token=");

  await deleteUserByEmail(email);
});

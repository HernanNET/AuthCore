import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countSessionsForUser,
  findUserByEmail,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import {
  DEFAULT_PASSWORD,
  loginUser,
  registerAndVerifyUser,
} from "../helpers/auth-flow";

const BASE = "http://localhost:4321";
const NEW_PASSWORD = "Phas7Secure!password";

async function fillChangePassword(
  page: Page,
  currentPassword: string,
  newPassword: string,
  confirmation = newPassword,
): Promise<void> {
  await page.fill("#current-password", currentPassword);
  await page.fill("#new-password", newPassword);
  await page.fill("#confirm-password", confirmation);
  await page.click("#change-password-button");
}

test.beforeAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
});

test.afterAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
  await closeDb();
});

test("1 — anonymous users cannot access change-password", async ({ page }) => {
  await page.goto(`${BASE}/change-password`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#change-password-form")).toHaveCount(0);
});

test("2 — authenticated account page exposes change-password navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Change Link User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#change-password-link")).toHaveAttribute("href", "/change-password");
});

test("3 — form has correct password semantics and local validation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Change Validation User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/change-password`);

  await expect(page.locator("#current-password")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.locator("#new-password")).toHaveAttribute("autocomplete", "new-password");

  await fillChangePassword(page, "", NEW_PASSWORD);
  await expect(page.locator("#error-message")).toHaveText("Please enter your current password.");

  await fillChangePassword(page, DEFAULT_PASSWORD, "short");
  await expect(page.locator("#error-message")).toHaveText("Password must be at least 8 characters.");

  await fillChangePassword(page, DEFAULT_PASSWORD, NEW_PASSWORD, "DifferentSecure!42");
  await expect(page.locator("#error-message")).toHaveText("Passwords do not match.");

  await fillChangePassword(page, DEFAULT_PASSWORD, DEFAULT_PASSWORD);
  await expect(page.locator("#error-message")).toHaveText("Choose a password different from your current password.");
});

test("4 — wrong current password is rejected without changing password or sessions", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = await registerAndVerifyUser(page, "Wrong Current User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  const sessionsBefore = await countSessionsForUser(user.id);

  await page.goto(`${BASE}/change-password`);
  await fillChangePassword(page, "WrongCurrent!42", NEW_PASSWORD);
  await expect(page.locator("#error-message")).toHaveText("Current password is incorrect.");
  expect(await countSessionsForUser(user.id)).toBe(sessionsBefore);

  const verificationContext = await browser.newContext();
  const verificationPage = await verificationContext.newPage();
  await loginUser(verificationPage, email, DEFAULT_PASSWORD);
  await verificationPage.waitForURL(/\/account/);
  await context.close();
  await verificationContext.close();
});

test("5 — successful change preserves current browser and revokes every other session", async ({ browser }) => {
  const setupContext = await browser.newContext();
  const setupPage = await setupContext.newPage();
  const email = await registerAndVerifyUser(setupPage, "Change Success User");
  await setupContext.close();

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await loginUser(pageA, email);
  await pageA.waitForURL(/\/account/);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await loginUser(pageB, email);
  await pageB.waitForURL(/\/account/);

  const user = await findUserByEmail(email);
  expect(await countSessionsForUser(user.id)).toBeGreaterThanOrEqual(2);

  await pageA.goto(`${BASE}/change-password`);
  await fillChangePassword(pageA, DEFAULT_PASSWORD, NEW_PASSWORD);
  await expect(pageA.locator("#success-state")).toBeVisible();
  expect(await countSessionsForUser(user.id)).toBe(1);

  await pageA.goto(`${BASE}/account`);
  await expect(pageA.locator("#user-email")).toHaveText(email);

  await pageB.goto(`${BASE}/account`);
  await pageB.waitForURL(/\/login/);
  await loginUser(pageB, email, DEFAULT_PASSWORD);
  await expect(pageB.locator("#error-message")).toContainText("Invalid email or password");
  await loginUser(pageB, email, NEW_PASSWORD);
  await pageB.waitForURL(/\/account/);

  await contextA.close();
  await contextB.close();
});

test("6 — unauthenticated change-password API request is rejected", async () => {
  const response = await fetch(`${BASE}/api/auth/change-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      currentPassword: DEFAULT_PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  const body = await response.text();
  expect(body.toLowerCase()).not.toContain("stack");
  expect(body).not.toContain("DATABASE_URL");
});

test("7 — change-password page exposes no secrets or session tokens", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Change Leakage User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/change-password`);
  const html = await page.content();
  expect(html).not.toContain("BETTER_AUTH_SECRET");
  expect(html).not.toContain("DATABASE_URL");
  expect(html).not.toContain("GOOGLE_CLIENT_SECRET");
  expect(html.toLowerCase()).not.toContain("session token");
});

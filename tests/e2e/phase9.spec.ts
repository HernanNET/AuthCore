import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countAccountsForUser,
  countSessionsForUser,
  findUserByEmail,
} from "../helpers/db";
import {
  clearAllMailbox,
  fetchCapturedEmails,
  waitForEmailChangeConfirmation,
  waitForVerificationEmail,
} from "../helpers/mailbox";
import {
  DEFAULT_PASSWORD,
  loginUser,
  registerAndVerifyUser,
} from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

async function requestChange(page: Page, newEmail: string): Promise<void> {
  await page.goto(`${BASE}/change-email`);
  await page.fill("#new-email", newEmail);
  await page.fill("#confirm-email", newEmail);
  await page.click("#change-email-button");
  await expect(page.locator("#success-state")).toBeVisible();
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

test("1 — anonymous users cannot access change-email", async ({ page }) => {
  await page.goto(`${BASE}/change-email`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#change-email-form")).toHaveCount(0);
});

test("2 — account page exposes change-email navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Email Link User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#change-email-link")).toHaveAttribute("href", "/change-email");
});

test("3 — form validates malformed, mismatched, and unchanged addresses locally", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Email Validation User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/change-email`);

  await page.fill("#new-email", "not-an-email");
  await page.fill("#confirm-email", "not-an-email");
  await page.click("#change-email-button");
  await expect(page.locator("#error-message")).toHaveText("Please enter a valid email address.");

  await page.fill("#new-email", "playwright-new@example.test");
  await page.fill("#confirm-email", "playwright-other@example.test");
  await page.click("#change-email-button");
  await expect(page.locator("#error-message")).toHaveText("Email addresses do not match.");

  await page.fill("#new-email", email);
  await page.fill("#confirm-email", email);
  await page.click("#change-email-button");
  await expect(page.locator("#error-message")).toHaveText("Choose an email different from your current email.");
});

test("4 — request sends approval to current address without changing identity", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Email Request User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const original = await findUserByEmail(email);
  const newEmail = `playwright-new-${Date.now()}@example.test`;

  await requestChange(page, newEmail);
  const confirmation = await waitForEmailChangeConfirmation(email);
  expect(confirmation.to).toBe(email);
  expect(await findUserByEmail(newEmail)).toBeNull();
  expect((await findUserByEmail(email)).id).toBe(original.id);
  expect((await fetchCapturedEmails(newEmail)).filter((message) => message.purpose === "email-verification")).toHaveLength(0);
});

test("5 — double confirmation changes only the email and preserves identity", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const oldEmail = await registerAndVerifyUser(page, "Email Success User");
  await loginUser(page, oldEmail);
  await page.waitForURL(/\/account/);
  const original = await findUserByEmail(oldEmail);
  const accountsBefore = await countAccountsForUser(original.id);
  const newEmail = `playwright-changed-${Date.now()}@example.test`;

  await requestChange(page, newEmail);
  const approval = await waitForEmailChangeConfirmation(oldEmail);
  await page.goto(approval.verificationUrl);
  await page.waitForURL(/\/change-email-result\?status=processed/);
  await expect(page.locator("#change-email-success")).toBeVisible();
  expect((await findUserByEmail(oldEmail)).id).toBe(original.id);
  expect(await findUserByEmail(newEmail)).toBeNull();

  const verification = await waitForVerificationEmail(newEmail);
  await page.goto(verification.verificationUrl);
  await page.waitForURL(/\/change-email-result\?status=processed/);
  await expect(page.locator("#result-email")).toHaveText(newEmail);

  expect(await findUserByEmail(oldEmail)).toBeNull();
  const updated = await findUserByEmail(newEmail);
  expect(updated.id).toBe(original.id);
  expect(updated.emailVerified).toBe(true);
  expect(await countAccountsForUser(updated.id)).toBe(accountsBefore);
  expect(await countSessionsForUser(updated.id)).toBe(1);

  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginUser(loginPage, oldEmail, DEFAULT_PASSWORD);
  await expect(loginPage.locator("#error-message")).toContainText("Invalid email or password");
  await loginUser(loginPage, newEmail, DEFAULT_PASSWORD);
  await loginPage.waitForURL(/\/account/);

  await page.goto(approval.verificationUrl);
  await page.waitForURL(/\/change-email-result\?.*error=/);
  await expect(page.locator("#change-email-error")).toBeVisible();

  await context.close();
  await loginContext.close();
});

test("6 — an existing target address receives the same generic UI", async ({ browser }) => {
  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const existingEmail = await registerAndVerifyUser(targetPage, "Existing Target User");
  await targetContext.close();

  const sourceContext = await browser.newContext();
  const sourcePage = await sourceContext.newPage();
  const sourceEmail = await registerAndVerifyUser(sourcePage, "Existing Source User");
  await loginUser(sourcePage, sourceEmail);
  await sourcePage.waitForURL(/\/account/);
  await requestChange(sourcePage, existingEmail);
  await expect(sourcePage.locator("#success-state")).toContainText("Check your current email");
  expect((await findUserByEmail(sourceEmail)).email).toBe(sourceEmail);
  expect((await fetchCapturedEmails(sourceEmail)).filter((message) => message.purpose === "email-change-confirmation")).toHaveLength(0);
  await sourceContext.close();
});

test("7 — unauthenticated change-email API requests are rejected safely", async () => {
  const response = await fetch(`${BASE}/api/auth/change-email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      newEmail: "playwright-new@example.test",
      callbackURL: "/change-email-result?status=processed",
    }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  const body = await response.text();
  expect(body.toLowerCase()).not.toContain("stack");
  expect(body).not.toContain("DATABASE_URL");
});

test("8 — change-email pages expose no tokens or server secrets", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Email Leakage User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/change-email`);
  const html = await page.content();
  expect(html).not.toContain("BETTER_AUTH_SECRET");
  expect(html).not.toContain("DATABASE_URL");
  expect(html).not.toContain("GOOGLE_CLIENT_SECRET");
  expect(html.toLowerCase()).not.toContain("verification token");
  await expect(page.locator("[data-token], input[name=token]")).toHaveCount(0);
});

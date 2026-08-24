import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countSessionsForUser,
  expirePasswordResetTokens,
  findUserByEmail,
} from "../helpers/db";
import { clearAllMailbox, fetchCapturedEmails, waitForPasswordResetEmail } from "../helpers/mailbox";
import {
  DEFAULT_PASSWORD,
  loginUser,
  registerAndVerifyUser,
} from "../helpers/auth-flow";

const BASE = "http://localhost:4321";
const NEW_PASSWORD = "N3wSecure!password";

async function requestReset(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE}/forgot-password`);
  await page.fill("#email", email);
  await page.click("#forgot-button");
  await expect(page.locator("#success-state")).toBeVisible();
}

async function openResetForm(page: Page, email: string): Promise<string> {
  const message = await waitForPasswordResetEmail(email);
  await page.goto(message.verificationUrl);
  await page.waitForURL(/\/reset-password\?token=/);
  await expect(page.locator("#reset-form")).toBeVisible();
  return new URL(page.url()).searchParams.get("token") ?? "";
}

async function submitNewPassword(page: Page, password = NEW_PASSWORD): Promise<void> {
  await page.fill("#password", password);
  await page.fill("#confirm-password", password);
  await page.click("#reset-button");
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

test("1 — login exposes forgot-password navigation", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
});

test("2 — forgot-password validates malformed email locally", async ({ page }) => {
  await page.goto(`${BASE}/forgot-password`);
  await page.fill("#email", "not-an-email");
  await page.click("#forgot-button");
  await expect(page.locator("#error-message")).toHaveText("Please enter a valid email address.");
});

test("3 — known and unknown emails receive the same anti-enumeration UI", async ({ browser }) => {
  const setup = await browser.newContext();
  const setupPage = await setup.newPage();
  const knownEmail = await registerAndVerifyUser(setupPage, "Reset Enumeration User");
  await setup.close();

  const knownContext = await browser.newContext();
  const knownPage = await knownContext.newPage();
  await requestReset(knownPage, knownEmail);
  const knownMessage = await knownPage.locator("#success-state").textContent();

  const unknownEmail = `playwright-unknown-${Date.now()}@example.test`;
  const unknownContext = await browser.newContext();
  const unknownPage = await unknownContext.newPage();
  await requestReset(unknownPage, unknownEmail);
  const unknownMessage = await unknownPage.locator("#success-state").textContent();

  expect(unknownMessage).toBe(knownMessage);
  const unknownMailbox = await fetchCapturedEmails(unknownEmail);
  expect(unknownMailbox.filter((message) => message.purpose === "password-reset")).toHaveLength(0);

  await knownContext.close();
  await unknownContext.close();
});

test("4 — valid reset changes password and revokes every existing session", async ({ browser }) => {
  const setupContext = await browser.newContext();
  const setupPage = await setupContext.newPage();
  const email = await registerAndVerifyUser(setupPage, "Reset Success User");
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

  await requestReset(pageA, email);
  await openResetForm(pageA, email);
  await submitNewPassword(pageA);
  await expect(pageA.locator("#success-state")).toBeVisible();
  expect(await countSessionsForUser(user.id)).toBe(0);

  await loginUser(pageB, email, DEFAULT_PASSWORD);
  await expect(pageB.locator("#error-message")).toContainText("Invalid email or password");
  await loginUser(pageB, email, NEW_PASSWORD);
  await pageB.waitForURL(/\/account/);

  await contextA.close();
  await contextB.close();
});

test("5 — reset token is single-use", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Reset Replay User");
  await requestReset(page, email);
  const token = await openResetForm(page, email);
  expect(token.length).toBeGreaterThan(10);
  await submitNewPassword(page);
  await expect(page.locator("#success-state")).toBeVisible();

  const replay = await fetch(`${BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword: "AnotherSecure!42" }),
  });
  expect(replay.status).toBeGreaterThanOrEqual(400);
  expect(replay.status).toBeLessThan(500);
});

test("6 — reset form rejects short and mismatched passwords", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Reset Validation User");
  await requestReset(page, email);
  await openResetForm(page, email);

  await page.fill("#password", "short");
  await page.fill("#confirm-password", "short");
  await page.click("#reset-button");
  await expect(page.locator("#error-message")).toHaveText("Password must be at least 8 characters.");

  await page.fill("#password", NEW_PASSWORD);
  await page.fill("#confirm-password", "DifferentSecure!42");
  await page.click("#reset-button");
  await expect(page.locator("#error-message")).toHaveText("Passwords do not match.");
});

test("7 — invalid reset link fails safely", async ({ page }) => {
  await page.goto(`${BASE}/reset-password?error=INVALID_TOKEN`);
  await expect(page.locator("#invalid-state")).toContainText("invalid or has expired");
  await expect(page.locator("#reset-form")).toHaveCount(0);
});

test("8 — expired native reset token cannot update the password", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Reset Expiry User");
  await requestReset(page, email);
  const user = await findUserByEmail(email);
  await expirePasswordResetTokens(user.id);
  const message = await waitForPasswordResetEmail(email);
  await page.goto(message.verificationUrl);
  await page.waitForURL(/\/reset-password\?error=/);
  await expect(page.locator("#invalid-state")).toBeVisible();
});

test("9 — reset pages and responses expose no server secrets", async ({ page }) => {
  await page.goto(`${BASE}/forgot-password`);
  const forgotHtml = await page.content();
  expect(forgotHtml).not.toContain("BETTER_AUTH_SECRET");
  expect(forgotHtml).not.toContain("DATABASE_URL");
  expect(forgotHtml).not.toContain("GOOGLE_CLIENT_SECRET");

  const response = await fetch(`${BASE}/api/auth/request-password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "playwright-absent@example.test", redirectTo: "/reset-password" }),
  });
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).not.toContain("stack");
  expect(body).not.toContain("DATABASE_URL");
});

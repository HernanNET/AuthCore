import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countAccountDeletionTokens,
  countAccountsForUser,
  countSessionsForUser,
  findUserByEmail,
} from "../helpers/db";
import {
  clearAllMailbox,
  waitForAccountDeletionEmail,
} from "../helpers/mailbox";
import { loginUser, registerAndVerifyUser } from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

async function requestDeletion(page: Page): Promise<void> {
  await page.goto(`${BASE}/delete-account`);
  await page.fill("#confirmation", "DELETE");
  await page.check("#understand");
  await page.click("#delete-account-button");
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

test("1 — anonymous users cannot access account deletion", async ({ page }) => {
  await page.goto(`${BASE}/delete-account`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#delete-account-form")).toHaveCount(0);
});

test("2 — account page exposes deliberate danger-zone navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Delete Link User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#delete-account-link")).toHaveAttribute("href", "/delete-account");
});

test("3 — exact phrase and irreversible-action checkbox are required", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Delete Validation User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/delete-account`);

  await page.fill("#confirmation", "delete");
  await page.check("#understand");
  await page.click("#delete-account-button");
  await expect(page.locator("#error-message")).toHaveText("Type DELETE exactly to continue.");

  await page.fill("#confirmation", "DELETE");
  await page.uncheck("#understand");
  await page.click("#delete-account-button");
  await expect(page.locator("#error-message")).toHaveText("Confirm that you understand this action cannot be undone.");
});

test("4 — requesting deletion sends a token but leaves all data intact", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Delete Request User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  const accountsBefore = await countAccountsForUser(user.id);
  const sessionsBefore = await countSessionsForUser(user.id);

  await requestDeletion(page);
  const message = await waitForAccountDeletionEmail(email);
  expect(message.to).toBe(email);
  expect(message.verificationUrl).toContain("/confirm-account-deletion?token=");
  expect((await findUserByEmail(email)).id).toBe(user.id);
  expect(await countAccountsForUser(user.id)).toBe(accountsBefore);
  expect(await countSessionsForUser(user.id)).toBe(sessionsBefore);
  expect(await countAccountDeletionTokens(user.id)).toBe(1);
});

test("5 — invalid or missing deletion links fail without deleting", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Delete Invalid User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);

  await page.goto(`${BASE}/confirm-account-deletion`);
  await page.waitForURL(/\/account-deleted\?error=invalid/);
  await expect(page.locator("#deletion-error")).toBeVisible();

  await page.goto(`${BASE}/confirm-account-deletion?token=invalid-token`);
  await page.waitForURL(/\/account-deleted\?error=invalid/);
  await expect(page.locator("#deletion-error")).toBeVisible();
  expect(await findUserByEmail(email)).not.toBeNull();
});

test("6 — verified deletion removes user, accounts, sessions, and token", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Delete Success User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  await requestDeletion(page);
  const message = await waitForAccountDeletionEmail(email);

  await page.goto(message.verificationUrl);
  await page.waitForURL(/\/account-deleted\?status=success/);
  await expect(page.locator("#deletion-success")).toBeVisible();
  expect(await findUserByEmail(email)).toBeNull();
  expect(await countAccountsForUser(user.id)).toBe(0);
  expect(await countSessionsForUser(user.id)).toBe(0);
  expect(await countAccountDeletionTokens(user.id)).toBe(0);

  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/login/);

  await page.goto(message.verificationUrl);
  await page.waitForURL(/\/account-deleted\?error=invalid/);
  await expect(page.locator("#deletion-error")).toBeVisible();
});

test("7 — one signed-in user cannot consume another user's deletion link", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const emailA = await registerAndVerifyUser(pageA, "Delete Owner User");
  await loginUser(pageA, emailA);
  await pageA.waitForURL(/\/account/);
  await requestDeletion(pageA);
  const message = await waitForAccountDeletionEmail(emailA);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const emailB = await registerAndVerifyUser(pageB, "Delete Attacker User");
  await loginUser(pageB, emailB);
  await pageB.waitForURL(/\/account/);
  await pageB.goto(message.verificationUrl);
  await pageB.waitForURL(/\/account-deleted\?error=invalid/);

  expect(await findUserByEmail(emailA)).not.toBeNull();
  expect(await findUserByEmail(emailB)).not.toBeNull();
  await contextA.close();
  await contextB.close();
});

test("8 — unauthenticated delete-user API requests are rejected safely", async () => {
  const response = await fetch(`${BASE}/api/auth/delete-user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callbackURL: "/account-deleted?status=success" }),
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
  const body = await response.text();
  expect(body.toLowerCase()).not.toContain("stack");
  expect(body).not.toContain("DATABASE_URL");
});

test("9 — deletion pages render no token or server secrets", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Delete Leakage User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/delete-account`);
  const html = await page.content();
  expect(html).not.toContain("BETTER_AUTH_SECRET");
  expect(html).not.toContain("DATABASE_URL");
  expect(html).not.toContain("GOOGLE_CLIENT_SECRET");
  expect(html.toLowerCase()).not.toContain("deletion token");
  await expect(page.locator("[data-token], input[name=token]")).toHaveCount(0);
});

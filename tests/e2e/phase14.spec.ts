import { test, expect } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countSecurityEventsForUser,
  deleteUserByEmail,
  findUserByEmail,
  securityEventTypesForUser,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import { DEFAULT_PASSWORD, loginUser, registerAndVerifyUser } from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

test("1 — anonymous users cannot read security activity", async ({ page }) => {
  await page.goto(`${BASE}/security-activity`);
  await page.waitForURL(/\/login/);
});

test("2 — account exposes security-activity navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Audit Link User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#security-activity-link")).toHaveAttribute("href", "/security-activity");
});

test("3 — account creation and sign-in are recorded server-side", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Audit Events User");
  const user = await findUserByEmail(email);
  expect(await securityEventTypesForUser(user.id)).toContain("account_created");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  expect(await securityEventTypesForUser(user.id)).toEqual(
    expect.arrayContaining(["account_created", "signed_in"]),
  );
});

test("4 — successful password change appears in the user's history", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Audit Password User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/change-password`);
  await page.fill("#current-password", DEFAULT_PASSWORD);
  await page.fill("#new-password", "N3wSecure!password");
  await page.fill("#confirm-password", "N3wSecure!password");
  await page.click("#change-password-button");
  await expect(page.locator("#success-state")).toBeVisible();
  await page.goto(`${BASE}/security-activity`);
  await expect(page.locator('[data-event-type="password_changed"]')).toBeVisible();
});

test("5 — sign-out is recorded without preserving session secrets", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Audit Signout User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.click("#signout-button");
  await page.waitForURL(/\/login/);
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/security-activity`);
  await expect(page.locator('[data-event-type="signed_out"]')).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(DEFAULT_PASSWORD);
  expect(html).not.toContain("better-auth.session_token");
});

test("6 — users only see events belonging to their own identity", async ({ browser }) => {
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  const firstEmail = await registerAndVerifyUser(firstPage, "Audit First User");
  const firstUser = await findUserByEmail(firstEmail);
  await loginUser(firstPage, firstEmail);
  await firstPage.waitForURL(/\/account/);

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  const secondEmail = await registerAndVerifyUser(secondPage, "Audit Second User");
  await loginUser(secondPage, secondEmail);
  await secondPage.waitForURL(/\/account/);
  await secondPage.goto(`${BASE}/security-activity`);

  expect(await countSecurityEventsForUser(firstUser.id)).toBeGreaterThan(0);
  await expect(secondPage.locator("#security-event-list li")).toHaveCount(2);
  await first.close();
  await second.close();
});

test("7 — deleting a user cascades their security history", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Audit Delete User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  expect(await countSecurityEventsForUser(user.id)).toBeGreaterThan(0);
  await deleteUserByEmail(email);
  expect(await countSecurityEventsForUser(user.id)).toBe(0);
});

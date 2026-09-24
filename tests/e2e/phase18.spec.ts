import { test, expect, type Page } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countSessionsForUser,
  findUserByEmail,
  securityEventTypesForUser,
  setUserRole,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import { loginUser, registerAndVerifyUser } from "../helpers/auth-flow";
import { createTwoFactorAdmin } from "../helpers/two-factor";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

async function createAdmin(page: Page, name = "Phase Eighteen Admin") {
  const { email, user } = await createTwoFactorAdmin(page, name);
  return { email, user };
}

async function createSignedInUser(page: Page, name: string) {
  const email = await registerAndVerifyUser(page, name);
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  return { email, user };
}

async function acceptNextDialog(page: Page) {
  page.once("dialog", async (dialog) => dialog.accept());
}

test("1 — administrators can search users by email without exposing secrets", async ({ browser }) => {
  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const target = await createSignedInUser(targetPage, "Searchable Regular User");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = await createAdmin(adminPage);
  await adminPage.goto(`${BASE}/admin?field=email&q=${encodeURIComponent(target.email)}`);

  await expect(adminPage.locator(`tr[data-user-email="${target.email}"]`)).toBeVisible();
  await expect(adminPage.locator(`tr[data-user-email="${admin.email}"]`)).toHaveCount(0);
  const html = await adminPage.content();
  expect(html).not.toContain("sessionToken");
  expect(html).not.toContain("password");
  await targetContext.close();
  await adminContext.close();
});

test("2 — regular users cannot block accounts through the native endpoint", async ({ page }) => {
  const regular = await createSignedInUser(page, "Unauthorized Manager");
  const status = await page.evaluate(async (userId) => {
    const response = await fetch("/api/auth/admin/ban-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    return response.status;
  }, regular.user.id);
  expect(status).toBe(403);
  expect((await findUserByEmail(regular.email)).banned).toBe(false);
});

test("3 — blocking a user revokes every active session", async ({ browser }) => {
  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const target = await createSignedInUser(targetPage, "Block Target User");
  expect(await countSessionsForUser(target.user.id)).toBe(1);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);
  await adminPage.goto(`${BASE}/admin?field=email&q=${encodeURIComponent(target.email)}`);
  const row = adminPage.locator(`[data-user-email="${target.email}"]`);
  await acceptNextDialog(adminPage);
  await row.locator('[data-action="ban"]').click();
  await expect(adminPage.locator(`[data-user-email="${target.email}"] .user-status`)).toHaveText("Blocked");

  expect((await findUserByEmail(target.email)).banned).toBe(true);
  expect(await countSessionsForUser(target.user.id)).toBe(0);
  expect(await securityEventTypesForUser(target.user.id)).toContain("admin_user_blocked");
  await targetPage.goto(`${BASE}/account`);
  await expect(targetPage).toHaveURL(/\/login$/);
  await targetContext.close();
  await adminContext.close();
});

test("4 — an administrator can unblock a user", async ({ browser }) => {
  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const target = await createSignedInUser(targetPage, "Unblock Target User");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);
  await adminPage.goto(`${BASE}/admin?field=email&q=${encodeURIComponent(target.email)}`);
  await acceptNextDialog(adminPage);
  await adminPage.locator(`[data-user-email="${target.email}"] [data-action="ban"]`).click();
  await expect(adminPage.locator(`[data-user-email="${target.email}"] .user-status`)).toHaveText("Blocked");

  await acceptNextDialog(adminPage);
  await adminPage.locator(`[data-user-email="${target.email}"] [data-action="unban"]`).click();
  await expect(adminPage.locator(`[data-user-email="${target.email}"] .user-status`)).toHaveText("Active");
  expect((await findUserByEmail(target.email)).banned).toBe(false);
  expect(await securityEventTypesForUser(target.user.id)).toContain("admin_user_unblocked");
  await loginUser(targetPage, target.email);
  await targetPage.waitForURL(/\/account/);
  await targetContext.close();
  await adminContext.close();
});

test("5 — session revocation signs the selected user out without blocking them", async ({ browser }) => {
  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const target = await createSignedInUser(targetPage, "Revoke Target User");

  const secondTargetContext = await browser.newContext();
  const secondTargetPage = await secondTargetContext.newPage();
  await loginUser(secondTargetPage, target.email);
  await secondTargetPage.waitForURL(/\/account/);
  expect(await countSessionsForUser(target.user.id)).toBe(2);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);
  await adminPage.goto(`${BASE}/admin?field=email&q=${encodeURIComponent(target.email)}`);
  await acceptNextDialog(adminPage);
  await adminPage.locator(`[data-user-email="${target.email}"] [data-action="revoke"]`).click();

  await expect.poll(() => countSessionsForUser(target.user.id)).toBe(0);
  expect((await findUserByEmail(target.email)).banned).toBe(false);
  expect(await securityEventTypesForUser(target.user.id)).toContain("admin_sessions_revoked");
  await targetPage.goto(`${BASE}/account`);
  await expect(targetPage).toHaveURL(/\/login$/);
  await targetContext.close();
  await secondTargetContext.close();
  await adminContext.close();
});

test("6 — the native plugin prevents an administrator from blocking itself", async ({ page }) => {
  const admin = await createAdmin(page, "Self Protected Admin");
  const status = await page.evaluate(async (userId) => {
    const response = await fetch("/api/auth/admin/ban-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    return response.status;
  }, admin.user.id);
  expect(status).toBe(400);
  expect((await findUserByEmail(admin.email)).banned).toBe(false);
  await page.goto(`${BASE}/admin`);
  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();
});

test("7 — impersonation remains forbidden by the least-privilege policy", async ({ browser }) => {
  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  const target = await createSignedInUser(targetPage, "No Impersonation Target");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await createAdmin(adminPage);
  const status = await adminPage.evaluate(async (userId) => {
    const response = await fetch("/api/auth/admin/impersonate-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    return response.status;
  }, target.user.id);
  expect(status).toBe(403);
  await adminPage.goto(`${BASE}/account`);
  await expect(adminPage.locator("#user-role")).toHaveText("admin");
  await targetContext.close();
  await adminContext.close();
});

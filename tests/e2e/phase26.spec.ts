import { test, expect } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  db,
  findUserByEmail,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import { loginUser, registerAndVerifyUser } from "../helpers/auth-flow";
import { createTwoFactorAdmin } from "../helpers/two-factor";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

test("1 — an administrator without 2FA is redirected and blocked from admin APIs", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "No 2FA Admin");
  // Promote directly to admin WITHOUT enabling 2FA (the setUserRole helper
  // enables 2FA by policy, so we update the role through raw SQL here).
  await db.query('UPDATE "user" SET role = $1, "updatedAt" = NOW() WHERE email = $2', ["admin", email.toLowerCase()]);

  await loginUser(page, email);
  await page.waitForURL(/\/account/);

  await page.goto(`${BASE}/admin`);
  await expect(page).toHaveURL(/\/admin\/require-2fa$/);
  await expect(page.getByRole("heading", { name: "Two-factor authentication required", exact: true })).toBeVisible();

  const status = await page.evaluate(async () => {
    const response = await fetch("/api/auth/admin/list-users");
    return response.status;
  });
  expect(status).toBe(403);
  await expect(page).toHaveURL(/\/admin\/require-2fa$/);
});

test("2 — an administrator with 2FA can access the administration area", async ({ page }) => {
  const { email } = await createTwoFactorAdmin(page, "2FA Admin");
  expect((await findUserByEmail(email)).twoFactorEnabled).toBe(true);

  await page.goto(`${BASE}/admin`);
  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();

  const status = await page.evaluate(async () => {
    const response = await fetch("/api/auth/admin/list-users?limit=1");
    return response.status;
  });
  expect(status).toBe(200);
});
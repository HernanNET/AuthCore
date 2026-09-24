import { test, expect } from "@playwright/test";
import { cleanupTestUsers, closeDb, findUserByEmail, setUserRole } from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import {
  DEFAULT_PASSWORD,
  loginUser,
  registerAndVerifyUser,
  uniqueEmail,
} from "../helpers/auth-flow";
import { createTwoFactorAdmin } from "../helpers/two-factor";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

test("1 — registration assigns user and rejects browser-supplied roles", async ({ request }) => {
  const email = uniqueEmail();
  const response = await request.post(`${BASE}/api/auth/sign-up/email`, {
    data: {
      name: "Role Injection User",
      email,
      password: DEFAULT_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  const user = await findUserByEmail(email);
  expect(user.role).toBe("user");
  expect(user.banned).toBe(false);

  const injectedEmail = uniqueEmail();
  const injection = await request.post(`${BASE}/api/auth/sign-up/email`, {
    data: {
      name: "Rejected Role Input",
      email: injectedEmail,
      password: DEFAULT_PASSWORD,
      role: "admin",
    },
  });
  expect(injection.status()).toBe(400);
  expect(await findUserByEmail(injectedEmail)).toBeNull();
});

test("2 — anonymous visitors are redirected away from administration", async ({ page }) => {
  await page.goto(`${BASE}/admin`);
  await expect(page).toHaveURL(/\/login$/);
});

test("3 — authenticated regular users receive forbidden", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Regular Role User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const response = await page.goto(`${BASE}/admin`);
  expect(response?.status()).toBe(403);
  await expect(page.locator("body")).toContainText("Forbidden");
});

test("4 — regular users cannot call native admin endpoints", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Blocked Admin API User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/auth/admin/list-users");
    return response.status;
  });
  expect(status).toBe(403);
});

test("5 — an administrator sees the protected read-only user overview", async ({ page }) => {
  const { email } = await createTwoFactorAdmin(page, "Authorized Admin User");
  await expect(page.locator("#user-role")).toHaveText("admin");
  await expect(page.locator("#admin-link")).toBeVisible();
  await page.click("#admin-link");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();
  await expect(page.locator(`[data-user-email="${email}"]`)).toContainText("admin");
});

test("6 — changing a database role invalidates authorization immediately", async ({ page }) => {
  const { email } = await createTwoFactorAdmin(page, "Demoted Admin User");
  await page.goto(`${BASE}/admin`);
  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();

  await setUserRole(email, "user");
  const response = await page.goto(`${BASE}/admin`);
  expect(response?.status()).toBe(403);
});

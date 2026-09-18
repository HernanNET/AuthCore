import { test, expect } from "@playwright/test";
import {
  findUserByEmail,
  cleanupTestUsers,
  deleteUserByEmail,
  closeDb,
  setUserRole,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import {
  registerAndVerifyUser,
  loginUser,
} from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";
const VERIFY_ENDPOINT = `${BASE}/api/authcore/verify`;

test.beforeAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
});

test.afterAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
  await closeDb();
});

test("1 - unauthenticated verify returns 401 with authenticated false", async ({ request }) => {
  const response = await request.get(VERIFY_ENDPOINT);
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ authenticated: false });
});

test("2 - verified user session verifies without admin claim", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Phase Twenty Two User");

  const user = await findUserByEmail(email);
  expect(user?.emailVerified).toBe(true);

  await loginUser(page, email);
  await page.waitForURL(/\/account/);

  const response = await page.request.get(VERIFY_ENDPOINT);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.authenticated).toBe(true);
  expect(body.admin).toBe(false);
  expect(body.roles).toContain("user");
  expect(body.user.email).toBe(email.toLowerCase());

  await deleteUserByEmail(email);
});

test("3 - promoted admin session reports the admin role", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Phase Twenty Two Admin");
  await setUserRole(email, "admin");

  await loginUser(page, email);
  await page.waitForURL(/\/account/);

  const response = await page.request.get(VERIFY_ENDPOINT);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.authenticated).toBe(true);
  expect(body.admin).toBe(true);
  expect(body.roles).toContain("admin");

  await deleteUserByEmail(email);
});

test("4 - deleted user's session fails verification", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Phase Twenty Two Deleted");

  await loginUser(page, email);
  await page.waitForURL(/\/account/);

  await deleteUserByEmail(email);

  const response = await page.request.get(VERIFY_ENDPOINT);
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ authenticated: false });
});

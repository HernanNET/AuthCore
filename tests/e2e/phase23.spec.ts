import { test, expect } from "@playwright/test";
import {
  cleanupTestUsers,
  deleteUserByEmail,
  closeDb,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import {
  registerAndVerifyUser,
  DEFAULT_PASSWORD,
} from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

test.beforeAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
});

test.afterAll(async () => {
  await cleanupTestUsers();
  await clearAllMailbox();
  await closeDb();
});

async function loginWithCallback(page: import("@playwright/test").Page, email: string, callbackURL: string) {
  await page.goto(`${BASE}/login?callbackURL=${encodeURIComponent(callbackURL)}`);
  await page.fill("#email", email);
  await page.fill("#password", DEFAULT_PASSWORD);
  await page.click("#login-button");
}

test("1 - login honors a relative callbackURL", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Callback Relative");
  await loginWithCallback(page, email, "/account");
  await page.waitForURL(/\/account/);
  expect(new URL(page.url()).pathname).toBe("/account");
  await deleteUserByEmail(email);
});

test("2 - login rejects an absolute foreign callbackURL", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Callback Foreign");
  await loginWithCallback(page, email, "https://evil.example/phish");
  await page.waitForURL(/\/account/);
  expect(new URL(page.url()).hostname).toBe("localhost");
  expect(new URL(page.url()).pathname).toBe("/account");
  await deleteUserByEmail(email);
});

test("3 - login rejects a protocol-relative callbackURL", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Callback ProtocolRelative");
  await loginWithCallback(page, email, "//evil.example/phish");
  await page.waitForURL(/\/account/);
  expect(new URL(page.url()).hostname).toBe("localhost");
  expect(new URL(page.url()).pathname).toBe("/account");
  await deleteUserByEmail(email);
});

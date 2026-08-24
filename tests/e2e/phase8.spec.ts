import { test, expect } from "@playwright/test";
import {
  cleanupTestUsers,
  closeDb,
  countSessionsForUser,
  findUserByEmail,
} from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import { loginUser, registerAndVerifyUser } from "../helpers/auth-flow";

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

test("1 — anonymous users cannot access session management", async ({ page }) => {
  await page.goto(`${BASE}/sessions`);
  await page.waitForURL(/\/login/);
  await expect(page.locator("#session-list")).toHaveCount(0);
});

test("2 — account page exposes session-management navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Sessions Link User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await expect(page.locator("#sessions-link")).toHaveAttribute("href", "/sessions");
});

test("3 — current session is identified without a revoke control", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Current Session User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/sessions`);

  const current = page.locator('.session-card[data-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current.locator(".badge")).toHaveText("This device");
  await expect(current.locator("button")).toHaveCount(0);
});

test("4 — a selected remote session can be revoked", async ({ browser }) => {
  const setup = await browser.newContext();
  const setupPage = await setup.newPage();
  const email = await registerAndVerifyUser(setupPage, "Single Revoke User");
  await setup.close();

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await loginUser(pageA, email);
  await pageA.waitForURL(/\/account/);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await loginUser(pageB, email);
  await pageB.waitForURL(/\/account/);

  const user = await findUserByEmail(email);
  expect(await countSessionsForUser(user.id)).toBe(2);

  await pageA.goto(`${BASE}/sessions`);
  const remote = pageA.locator('.session-card[data-current="false"]');
  await expect(remote).toHaveCount(1);
  await remote.locator("button").click();
  await expect(pageA.locator("#success-message")).toHaveText("The selected session was signed out.");
  await expect(pageA.locator('.session-card[data-current="false"]')).toHaveCount(0);
  expect(await countSessionsForUser(user.id)).toBe(1);

  await pageB.goto(`${BASE}/account`);
  await pageB.waitForURL(/\/login/);
  await pageA.goto(`${BASE}/account`);
  await expect(pageA.locator("#user-email")).toHaveText(email);

  await contextA.close();
  await contextB.close();
});

test("5 — all other sessions can be revoked while preserving the current one", async ({ browser }) => {
  const setup = await browser.newContext();
  const setupPage = await setup.newPage();
  const email = await registerAndVerifyUser(setupPage, "Bulk Revoke User");
  await setup.close();

  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of pages) {
    await loginUser(page, email);
    await page.waitForURL(/\/account/);
  }

  const user = await findUserByEmail(email);
  expect(await countSessionsForUser(user.id)).toBe(3);

  await pages[0].goto(`${BASE}/sessions`);
  await expect(pages[0].locator('.session-card[data-current="false"]')).toHaveCount(2);
  await pages[0].locator("#revoke-others-button").click();
  await expect(pages[0].locator("#success-message")).toHaveText("All other sessions were signed out.");
  await expect(pages[0].locator(".session-card")).toHaveCount(1);
  expect(await countSessionsForUser(user.id)).toBe(1);

  await pages[0].goto(`${BASE}/account`);
  await expect(pages[0].locator("#user-email")).toHaveText(email);
  for (const page of pages.slice(1)) {
    await page.goto(`${BASE}/account`);
    await page.waitForURL(/\/login/);
  }

  await Promise.all(contexts.map((context) => context.close()));
});

test("6 — unauthenticated session APIs are rejected safely", async () => {
  for (const request of [
    { method: "GET", path: "/api/auth/list-sessions" },
    { method: "POST", path: "/api/auth/revoke-other-sessions" },
  ]) {
    const response = await fetch(`${BASE}${request.path}`, { method: request.method });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    const body = await response.text();
    expect(body.toLowerCase()).not.toContain("stack");
    expect(body).not.toContain("DATABASE_URL");
  }
});

test("7 — session secrets are never rendered into the page DOM", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Session Leakage User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/sessions`);
  await expect(page.locator(".session-card")).toHaveCount(1);

  const html = await page.content();
  expect(html).not.toContain("BETTER_AUTH_SECRET");
  expect(html).not.toContain("DATABASE_URL");
  expect(html).not.toContain("GOOGLE_CLIENT_SECRET");
  expect(html.toLowerCase()).not.toContain("session_token");
  await expect(page.locator("[data-token], input[name=token]")).toHaveCount(0);
});

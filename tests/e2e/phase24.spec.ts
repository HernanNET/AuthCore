import { test, expect } from "@playwright/test";
import {
  deleteUserByEmail,
  findUserByEmail,
  getCredentialAccount,
  cleanupTestUsers,
  closeDb,
} from "../helpers/db";

/**
 * Phase 24 — machine-facing user provisioning for the multiclient product.
 *
 * The endpoint is fail-closed behind a shared secret and creates verified
 * credential users with a whitelisted role, so an administrator can create
 * sellers without an email round-trip.
 */

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";
const PROVISION_ENDPOINT = `${BASE}/api/authcore/provision`;
const SECRET = process.env.AUTHCORE_PROVISION_SECRET ?? "playwright-provision-secret-0123456789";

function provision(request: import("@playwright/test").APIRequestContext, body: unknown, secret?: string) {
  return request.post(PROVISION_ENDPOINT, {
    data: body,
    headers: secret === undefined ? { "x-authcore-provision-secret": SECRET } : { "x-authcore-provision-secret": secret },
  });
}

test.beforeAll(async () => {
  await cleanupTestUsers();
});

test.afterAll(async () => {
  await cleanupTestUsers();
  await closeDb();
});

test("1 - a missing or wrong secret is rejected and creates nothing", async ({ request }) => {
  const missing = await request.post(PROVISION_ENDPOINT, {
    data: { email: "playwright-seller-1@example.test", name: "Seller", password: "playwright-secret-123", role: "seller" },
  });
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toEqual({ error: "unauthorized" });

  const wrong = await provision(
    request,
    { email: "playwright-seller-1@example.test", name: "Seller", password: "playwright-secret-123", role: "seller" },
    "not-the-secret",
  );
  expect(wrong.status()).toBe(401);

  expect(await findUserByEmail("playwright-seller-1@example.test")).toBeNull();
});

test("2 - a valid request creates a verified credential seller", async ({ request }) => {
  const email = "playwright-seller-2@example.test";
  const response = await provision(request, { email, name: "Seller Two", password: "playwright-secret-123", role: "seller" });
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body.user.email).toBe(email);
  expect(body.user.role).toBe("seller");
  expect(typeof body.user.id).toBe("string");

  const user = await findUserByEmail(email);
  expect(user?.emailVerified).toBe(true);
  expect(user?.role).toBe("seller");
  expect(user?.banned).toBe(false);

  const account = await getCredentialAccount(body.user.id);
  expect(account?.providerId).toBe("credential");
  expect(typeof account?.password).toBe("string");

  await deleteUserByEmail(email);
});

test("3 - the provisioned seller can log in with the temporary password", async ({ page, request }) => {
  const email = "playwright-seller-3@example.test";
  const password = "playwright-secret-123";
  const created = await provision(request, { email, name: "Seller Three", password, role: "seller" });
  expect(created.status()).toBe(201);

  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/account/);

  const verify = await page.request.get(`${BASE}/api/authcore/verify`);
  expect(verify.status()).toBe(200);
  const session = await verify.json();
  expect(session.authenticated).toBe(true);
  expect(session.admin).toBe(false);
  expect(session.roles).toContain("seller");
  expect(session.user.email).toBe(email);

  await deleteUserByEmail(email);
});

test("4 - input validation and duplicates fail closed", async ({ request }) => {
  const email = "playwright-seller-4@example.test";
  const password = "playwright-secret-123";

  expect((await provision(request, { email: "not-an-email", name: "Seller", password, role: "seller" })).status()).toBe(400);
  expect((await provision(request, { email, name: "S", password, role: "seller" })).status()).toBe(400);
  expect((await provision(request, { email, name: "Seller", password: "short", role: "seller" })).status()).toBe(400);
  expect((await provision(request, { email, name: "Seller", password, role: "superadmin" })).status()).toBe(400);

  const first = await provision(request, { email, name: "Seller Four", password, role: "seller" });
  expect(first.status()).toBe(201);
  const duplicate = await provision(request, { email, name: "Seller Four", password, role: "seller" });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "email_exists" });

  await deleteUserByEmail(email);
});

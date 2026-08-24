import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { cleanupTestUsers, closeDb } from "../helpers/db";
import {
  clearAllMailbox,
  fetchCapturedEmails,
  waitForSecurityAlert,
} from "../helpers/mailbox";
import { DEFAULT_PASSWORD, loginUser, registerAndVerifyUser } from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("Missing TOTP secret");
  const counter = Math.floor(Date.now() / 30_000);
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(data).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function securityAlerts(email: string) {
  return (await fetchCapturedEmails(email)).filter((message) => message.purpose === "security-alert");
}

async function enrollTwoFactor(page: Page) {
  await page.goto(`${BASE}/two-factor-setup`);
  await page.fill("#password", DEFAULT_PASSWORD);
  await page.click("#enable-button");
  await expect(page.locator("#enrollment")).toBeVisible();
  const uri = await page.locator("#totp-uri-text").textContent() ?? "";
  await page.fill("#totp-code", totp(uri));
  await page.click("#verify-button");
  await expect(page.locator("#setup-success")).toBeVisible();
}

test.beforeEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterEach(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await closeDb(); });

test("1 — a sign-in from a new context sends a security alert", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Alert Login User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const alert = await waitForSecurityAlert(email, "signed_in");
  expect(alert.verificationUrl).toBe("");
  expect(alert.ipAddress).toBeTruthy();
  expect(alert.userAgent).toContain("Chrome");
});

test("2 — a familiar IP and browser do not receive repeated sign-in alerts", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Alert Familiar User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await waitForSecurityAlert(email, "signed_in");
  await page.click("#signout-button");
  await page.waitForURL(/\/login/);
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const alerts = (await securityAlerts(email)).filter((item) => item.securityEventType === "signed_in");
  expect(alerts).toHaveLength(1);
});

test("3 — failed password attempts never generate security mail", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Alert Failure User");
  await loginUser(page, email, "WrongPassword!42");
  await expect(page.locator("#error-message")).toBeVisible();
  expect(await securityAlerts(email)).toHaveLength(0);
});

test("4 — a successful password change sends a token-free alert", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Alert Password User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/change-password`);
  await page.fill("#current-password", DEFAULT_PASSWORD);
  await page.fill("#new-password", "N3wSecure!password");
  await page.fill("#confirm-password", "N3wSecure!password");
  await page.click("#change-password-button");
  await expect(page.locator("#success-state")).toBeVisible();
  const alert = await waitForSecurityAlert(email, "password_changed");
  const serialized = JSON.stringify(alert);
  expect(alert.verificationUrl).toBe("");
  expect(serialized).not.toContain(DEFAULT_PASSWORD);
  expect(serialized).not.toContain("N3wSecure!password");
  expect(serialized).not.toContain("token");
});

test("5 — enabling two-factor authentication sends an alert without enrollment secrets", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "Alert 2FA User");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  await enrollTwoFactor(page);
  const alert = await waitForSecurityAlert(email, "two_factor_enabled");
  const serialized = JSON.stringify(alert);
  expect(alert.verificationUrl).toBe("");
  expect(serialized).not.toContain("otpauth://");
  expect(serialized).not.toContain("backupCodes");
});

test("6 — alerts remain scoped to the correct recipient", async ({ browser }) => {
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  const firstEmail = await registerAndVerifyUser(firstPage, "Alert First User");
  await loginUser(firstPage, firstEmail);
  await firstPage.waitForURL(/\/account/);
  await waitForSecurityAlert(firstEmail, "signed_in");

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  const secondEmail = await registerAndVerifyUser(secondPage, "Alert Second User");
  expect(await securityAlerts(secondEmail)).toHaveLength(0);
  expect(await securityAlerts(firstEmail)).toHaveLength(1);
  await first.close();
  await second.close();
});

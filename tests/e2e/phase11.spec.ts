import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { cleanupTestUsers, closeDb, findUserByEmail } from "../helpers/db";
import { clearAllMailbox } from "../helpers/mailbox";
import { DEFAULT_PASSWORD, loginUser, registerAndVerifyUser } from "../helpers/auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("Missing TOTP secret");
  const counter = Math.floor(Date.now() / 30_000);
  const data = Buffer.alloc(8); data.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(data).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function enroll(page: Page): Promise<{ email: string; backupCode: string; uri: string }> {
  const email = await registerAndVerifyUser(page, "Two Factor User");
  await loginUser(page, email); await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/two-factor-setup`);
  await page.fill("#password", DEFAULT_PASSWORD); await page.click("#enable-button");
  await expect(page.locator("#enrollment")).toBeVisible();
  const uri = await page.locator("#totp-uri-text").textContent() ?? "";
  const backupCode = await page.locator("#backup-codes li").first().textContent() ?? "";
  await page.fill("#totp-code", totp(uri)); await page.click("#verify-button");
  await expect(page.locator("#setup-success")).toBeVisible();
  return { email, backupCode, uri };
}

test.beforeAll(async () => { await cleanupTestUsers(); await clearAllMailbox(); });
test.afterAll(async () => { await cleanupTestUsers(); await clearAllMailbox(); await closeDb(); });

test("1 — anonymous setup access is denied", async ({ page }) => {
  await page.goto(`${BASE}/two-factor-setup`); await page.waitForURL(/\/login/);
});

test("2 — account exposes 2FA navigation", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "2FA Link User"); await loginUser(page, email); await page.waitForURL(/\/account/);
  await expect(page.locator("#two-factor-link")).toHaveAttribute("href", "/two-factor-setup");
});

test("3 — wrong password cannot begin enrollment", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "2FA Password User"); await loginUser(page, email); await page.waitForURL(/\/account/);
  await page.goto(`${BASE}/two-factor-setup`); await page.fill("#password", "WrongPassword!42"); await page.click("#enable-button");
  await expect(page.locator("#enable-error")).toBeVisible(); await expect(page.locator("#enrollment")).toBeHidden();
});

test("4 — valid TOTP enrollment enables 2FA", async ({ page }) => {
  const { email } = await enroll(page);
  expect((await findUserByEmail(email)).twoFactorEnabled).toBe(true);
});

test("5 — password login creates no session until valid TOTP", async ({ browser }) => {
  const setup = await browser.newContext(); const setupPage = await setup.newPage();
  const { email, uri } = await enroll(setupPage); await setup.close();
  const context = await browser.newContext(); const page = await context.newPage();
  await loginUser(page, email); await page.waitForURL(/\/two-factor/);
  await page.fill("#code", "000000"); await page.locator("#totp-form button").click(); await expect(page.locator("#error-message")).toBeVisible();
  await page.fill("#code", totp(uri)); await page.locator("#totp-form button").click(); await page.waitForURL(/\/account/);
  await context.close();
});

test("6 — a recovery code completes login and is single-use", async ({ browser }) => {
  const setup = await browser.newContext(); const setupPage = await setup.newPage();
  const { email, backupCode } = await enroll(setupPage); await setup.close();
  const context = await browser.newContext(); const page = await context.newPage();
  await loginUser(page, email); await page.waitForURL(/\/two-factor/); await page.click("#show-backup");
  await page.fill("#backup-code", backupCode); await page.locator("#backup-form button").click(); await page.waitForURL(/\/account/);
  await context.close();
  const retry = await browser.newContext(); const retryPage = await retry.newPage(); await loginUser(retryPage, email); await retryPage.waitForURL(/\/two-factor/);
  await retryPage.click("#show-backup"); await retryPage.fill("#backup-code", backupCode); await retryPage.locator("#backup-form button").click();
  await expect(retryPage.locator("#error-message")).toBeVisible(); await retry.close();
});

test("7 — enrollment secrets are absent before password verification", async ({ page }) => {
  const email = await registerAndVerifyUser(page, "2FA Leakage User"); await loginUser(page, email); await page.waitForURL(/\/account/); await page.goto(`${BASE}/two-factor-setup`);
  const html = await page.content(); expect(html).not.toContain("otpauth://"); expect(html).not.toContain("backupCodes"); expect(html).not.toContain("BETTER_AUTH_SECRET");
});

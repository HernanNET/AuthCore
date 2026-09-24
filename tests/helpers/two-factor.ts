import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { findUserByEmail, setUserRole } from "./db";
import { DEFAULT_PASSWORD, loginUser, registerAndVerifyUser } from "./auth-flow";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";

/**
 * TOTP helpers + admin fixtures for the mandatory admin-2FA policy (Phase 26).
 * Enrollment runs through the real UI (two-factor-setup), and subsequent admin
 * logins complete the TOTP verification step, exactly like production admins.
 */

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** Generate the current 6-digit code for an otpauth URI (or raw base32 secret). */
export function totp(secretOrUri: string): string {
  const secret = secretOrUri.includes("://")
    ? new URL(secretOrUri).searchParams.get("secret") ?? ""
    : secretOrUri;
  if (!secret) throw new Error("Missing TOTP secret");
  const counter = Math.floor(Date.now() / 30_000);
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(data).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Enroll the currently logged-in user in TOTP 2FA; returns the otpauth URI. */
export async function enrollTwoFactor(page: Page): Promise<string> {
  await page.goto(`${BASE}/two-factor-setup`);
  await page.fill("#password", DEFAULT_PASSWORD);
  await page.click("#enable-button");
  await expect(page.locator("#enrollment")).toBeVisible();
  const uri = (await page.locator("#totp-uri-text").textContent()) ?? "";
  await page.fill("#totp-code", totp(uri));
  await page.click("#verify-button");
  await expect(page.locator("#setup-success")).toBeVisible();
  return uri;
}

/**
 * Create a verified administrator who already satisfies the admin-2FA policy.
 * Returns the logged-in page (valid session), the email and the TOTP URI so the
 * caller can sign in again later.
 */
export async function createTwoFactorAdmin(
  page: Page,
  name = "Two Factor Admin",
): Promise<{ email: string; uri: string; user: { id: string } }> {
  const email = await registerAndVerifyUser(page, name);
  await setUserRole(email, "admin");
  await loginUser(page, email);
  await page.waitForURL(/\/account/);
  const uri = await enrollTwoFactor(page);
  await page.goto(`${BASE}/account`);
  await page.waitForURL(/\/account/);
  const user = await findUserByEmail(email);
  return { email, uri, user: { id: user.id } };
}

/** Sign in as a 2FA-enabled administrator, completing the TOTP verification step. */
export async function loginTwoFactorAdmin(
  page: Page,
  email: string,
  uri: string,
  password: string = DEFAULT_PASSWORD,
): Promise<void> {
  await loginUser(page, email, password);
  await expect(page.locator("#code")).toBeVisible({ timeout: 15_000 });
  await page.fill("#code", totp(uri));
  await page.locator("#totp-form button").click();
  await page.waitForURL(/\/account/);
}
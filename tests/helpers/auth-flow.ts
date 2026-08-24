import type { Page } from "@playwright/test";
import { waitForVerificationEmail } from "./mailbox";

const BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";
const DEFAULT_PASSWORD = "Sup3rSecret!pass";

/** Generate a unique test email. */
export function uniqueEmail(): string {
  return `playwright-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Register via the browser UI. */
export async function registerUser(
  page: Page,
  name = "Phase Three",
  email?: string,
  password = DEFAULT_PASSWORD,
): Promise<string> {
  const userEmail = email ?? uniqueEmail();
  await page.goto(`${BASE}/register`);
  await page.fill("#name", name);
  await page.fill("#email", userEmail);
  await page.fill("#password", password);
  await page.fill("#confirm-password", password);
  await page.click("#register-button");
  return userEmail;
}

/** Capture verification email and return the verification URL. */
export async function captureVerificationUrl(email: string): Promise<string> {
  const msg = await waitForVerificationEmail(email);
  return msg.verificationUrl;
}

/**
 * Complete the full registration + verification flow through real browser interactions.
 * Returns the verified user's email.
 */
export async function registerAndVerifyUser(
  page: Page,
  name = "Phase Three",
  password = DEFAULT_PASSWORD,
): Promise<string> {
  const email = await registerUser(page, name, undefined, password);

  // Wait for success state
  await page.waitForSelector("#success-state", { state: "visible" });

  // Capture and navigate to verification URL
  const url = await captureVerificationUrl(email);
  await page.goto(url);

  // Wait for verification success page
  await page.waitForURL(/\/verify-email/);
  await page.waitForSelector("#verify-success", { state: "visible" });

  return email;
}

/** Login via the browser UI. */
export async function loginUser(
  page: Page,
  email: string,
  password: string = DEFAULT_PASSWORD,
  rememberMe = true,
): Promise<void> {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  if (!rememberMe) {
    await page.uncheck("#remember-me");
  }
  await page.click("#login-button");
}

export { DEFAULT_PASSWORD };

/**
 * Helpers for the test-only captured mailbox endpoint.
 */

const TEST_BASE = process.env.AUTHCORE_TEST_URL ?? "http://localhost:4321";
const PROD_SIM_BASE = "http://127.0.0.1:4322";

export interface CapturedEmail {
  id: string;
  to: string;
  verificationUrl: string;
  purpose?:
    | "email-verification"
    | "password-reset"
    | "email-change-confirmation"
    | "account-deletion"
    | "security-alert";
  createdAt: string;
  securityEventType?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Poll until a security alert for the requested event arrives. */
export async function waitForSecurityAlert(
  to: string,
  eventType: string,
  timeoutMs = 5000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await fetchCapturedEmails(to);
    const alerts = messages.filter(
      (message) => message.purpose === "security-alert" && message.securityEventType === eventType,
    );
    if (alerts.length > 0) return alerts[alerts.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No ${eventType} security alert captured for ${to} within ${timeoutMs}ms`);
}

/** Fetch captured verification emails for a recipient (test server). */
export async function fetchCapturedEmails(to: string): Promise<CapturedEmail[]> {
  const res = await fetch(
    `${TEST_BASE}/api/test/captured-verification-emails?to=${encodeURIComponent(to)}`,
  );
  if (!res.ok) throw new Error(`mailbox endpoint returned ${res.status}`);
  const body = (await res.json()) as { messages: CapturedEmail[] };
  return body.messages;
}

/** Poll the mailbox until at least one message arrives (or timeout). */
export async function waitForVerificationEmail(
  to: string,
  timeoutMs = 5000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await fetchCapturedEmails(to);
    const verificationMessages = messages.filter(
      (message) => !message.purpose || message.purpose === "email-verification",
    );
    if (verificationMessages.length > 0) return verificationMessages[verificationMessages.length - 1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No verification email captured for ${to} within ${timeoutMs}ms`);
}

/** Poll until a password-reset message arrives for the recipient. */
export async function waitForPasswordResetEmail(
  to: string,
  timeoutMs = 5000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await fetchCapturedEmails(to);
    const resetMessages = messages.filter((message) => message.purpose === "password-reset");
    if (resetMessages.length > 0) return resetMessages[resetMessages.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No password-reset email captured for ${to} within ${timeoutMs}ms`);
}

/** Poll until the current-address approval message for an email change arrives. */
export async function waitForEmailChangeConfirmation(
  to: string,
  timeoutMs = 5000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await fetchCapturedEmails(to);
    const confirmations = messages.filter(
      (message) => message.purpose === "email-change-confirmation",
    );
    if (confirmations.length > 0) return confirmations[confirmations.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email-change confirmation captured for ${to} within ${timeoutMs}ms`);
}

/** Poll until the final account-deletion message arrives. */
export async function waitForAccountDeletionEmail(
  to: string,
  timeoutMs = 5000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await fetchCapturedEmails(to);
    const deletionMessages = messages.filter(
      (message) => message.purpose === "account-deletion",
    );
    if (deletionMessages.length > 0) return deletionMessages[deletionMessages.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No account-deletion email captured for ${to} within ${timeoutMs}ms`);
}

/** Attempt to access the mailbox endpoint on the production-simulated server. */
export async function probeMailboxProduction(to: string): Promise<number> {
  // Retry a few times in case the server is still settling
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(
        `${PROD_SIM_BASE}/api/test/captured-verification-emails?to=${encodeURIComponent(to)}`,
      );
      return res.status;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Could not connect to production-sim server at ${PROD_SIM_BASE}`);
}

/** Clear all captured emails via the test endpoint. */
export async function clearAllMailbox(): Promise<void> {
  // The endpoint is test-only; clearing is done by deleting all per-recipient files
  // via a direct fetch with a special flag is not supported, so we hit the endpoint
  // for the test email and the test's own user cleanup handles the rest.
  // For a global clear, we call the endpoint for known test patterns.
  // Simplest: fetch is read-only, so we clear by removing files through the server
  // is not available. Instead, the test suite cleans users and the mailbox is
  // per-recipient, so after user deletion the mailbox files are stale but harmless.
  // To truly clear, we use a dedicated cleanup endpoint.
  await fetch(`${TEST_BASE}/api/test/clear-captured-verification-emails`, {
    method: "POST",
  });
}
